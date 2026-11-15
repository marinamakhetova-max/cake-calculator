const $ = id => document.getElementById(id)
const format = (value, digits = 3) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: digits}).format(value)
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]))
const roleNames = {baker:'Пекарю', pastry:'Кондитеру', materials:'Накладная'}
const storageKey = 'confectionery-workbench-1'
const readStore = () => {
  try { return JSON.parse(localStorage.getItem(storageKey)) || {} }
  catch { return {} }
}
const saved = readStore()
let catalog = [...recipes.filter(recipe => !saved.recipes?.some(item => item.id === recipe.id)), ...(saved.recipes || []).map(applyClarifiedRecipes)]
let history = [...(saved.history || []), ...initialHistory.filter(item => !saved.history?.some(record => record.id === item.id))]
const draftStorageKey = 'confectionery-drafts-1'
const savedDrafts = (() => {
  try { return JSON.parse(localStorage.getItem(draftStorageKey)) || {} }
  catch { return {} }
})()
let drafts = savedDrafts.records || []
let activeDraftId = savedDrafts.active || null
let snapshot = null
let activeTab = 'baker'
let fileConnection
const photoUrls = new Map()
const originalFiles = [
  ['Лимонно-маковый · ТТК', '547759_.jpg'],
  ['Пан де Жен маковый · задание пекарю', '547764_.xlsx'],
  ['Крем-чиз на масле · ТТК', '547758_.jpg'],
  ['Медовый · ТТК', '547767_.jpg'],
  ['Рыжик с клюквой · справочная карта', '547760_.jpg'],
  ['Рыжик · ТТК', '547761_.jpg'],
]

function persist(newCatalog, newHistory) {
  localStorage.setItem(storageKey, JSON.stringify({recipes:newCatalog, history:newHistory}))
  catalog = newCatalog
  history = newHistory
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function openFiles() {
  if (!fileConnection) {
    fileConnection = new Promise((resolve, reject) => {
      const request = indexedDB.open(storageKey, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('files', {keyPath:'id'})
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return fileConnection
}

async function fileAction(method, value) {
  const db = await openFiles()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', method === 'put' ? 'readwrite' : 'readonly')
    const request = tx.objectStore('files')[method](value)
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}

function recipeOptions(selected) {
  return catalog.map(item => `<option value="${html(item.id)}" ${selected === item.id ? 'selected' : ''}>${html(item.name)}</option>`).join('')
}

function showPage(name) {
  for (const page of document.querySelectorAll('.page')) page.hidden = page.id !== name
  for (const button of document.querySelectorAll('nav button')) {
    if (button.dataset.page === name) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }
  if (name === 'history') renderHistory()
  if (name === 'library') renderLibrary()
  window.scrollTo(0, 0)
}

function dataTable(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(label => `<th scope="col">${html(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${html(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function table(first, last, rows) {
  return dataTable([first,last],rows)
}

function currentRecipe() {
  return catalog.find(item => item.id === $('recipe').value)
}

function planFromForm() {
  const data = new FormData($('plan-form'))
  const entries = ['target','diameter','length','ratio','layers','trim','thickness','guests','geometryComponent']
  return {recipe:data.get('recipe'),mode:data.get('mode'),shapeType:data.get('shapeType'),
    coatEnabled:data.has('coatEnabled'),berryEnabled:data.has('berryEnabled'),extraEnabled:data.has('extraEnabled'),
    ...Object.fromEntries(entries.map(name => [name,Number(data.get(name))]))}
}

function shapeText({shape,width,length}) {
  if (shape === 'round') return `Ø${format(width,1)} см`
  return `${shape === 'oval' ? 'Овал' : 'Прямоугольник'} ${format(width,1)} × ${format(length,1)} см`
}

function toggleField(id,visible) {
  const field = $(id)
  field.closest('label').hidden = !visible
  field.disabled = !visible
  field.required = visible
}

function refreshPlanFields() {
  const recipe = currentRecipe()
  const choices = geometryComponents(recipe)
  const mode = $('mode')
  for (const option of mode.options) option.disabled = option.value !== 'mass' && !choices.length
  if (!mode.value || mode.selectedOptions[0].disabled) mode.value = 'mass'

  const selector = $('geometry-select')
  const old = selector.value
  selector.innerHTML = choices.map(({item,index}) => `<option value="${index}">${html(item.name)}</option>`).join('')
  if (old && choices.some(({index}) => String(index) === old)) selector.value = old
  const geometry = mode.value !== 'mass'
  const fixedSize = mode.value === 'diameter'
  const round = $('shape-type').value === 'round'
  $('geometry-fields').hidden = !geometry
  $('geometry-select-field').hidden = choices.length < 2
  $('width-label').textContent = round ? 'Диаметр торта, см' : 'Ширина торта, см'
  toggleField('diameter',fixedSize)
  toggleField('length',fixedSize && !round)
  toggleField('target',!fixedSize)
  toggleField('ratio',geometry && !fixedSize && !round)
  for (const id of ['layers','trim','thickness']) $(id).disabled = !geometry
  const {item,card} = choices.find(({index}) => index === Number(selector.value)) || {}
  $('trim-label').textContent = card?.trimIncluded ? 'Дополнительная обрезь, %' : 'Обрезь выбранных слоёв, %'
  $('geometry-source').textContent = card ? `${item.name}. ${shapeText(card)}, ${format(card.fill,1)} г теста и ≈ ${format(card.output,1)} г выхода на форму${card.trimIncluded ? ' после штатной обрезки' : ''}, слоёв из формы: ${card.layers}.` : ''
  $('recipe-note').textContent = choices.length ? '' : 'Пока доступен расчёт по весу. Для размеров добавьте в техкарту коржей форму, массу теста, выход после выпечки и число слоёв.'

  const norms = finishNorms(recipe)
  $('coat').disabled = !norms.coat || !recipe.components.some(item => item.kind === 'coat')
  $('berry').disabled = !norms.berry
  $('extra').disabled = !norms.extra || !norms.extraName
  $('extra-field').hidden = $('extra').disabled
  $('extra-label').textContent = norms.extraName || ''
  const applied = ['coat','berry','extra'].filter(key => !$(key).disabled && $(key).checked)
  const coating = geometry && applied.includes('coat') ? recipe.components.find(item => item.kind === 'coat')?.portion : null
  const massNorms = coating ? applied.filter(key => key !== 'coat') : applied
  const labels = {coat:'крем',berry:'клубника',extra:norms.extraName}
  const missing = [$('coat').disabled && 'крема', $('berry').disabled && 'клубники'].filter(Boolean)
  $('finish-note').textContent = [
    coating ? `Обтяжка: ${format(coating.grams,1)} г на Ø${format(coating.diameter,1)} см с пересчётом по площади.` : '',
    massNorms.length ? `Нормы на 1 кг основы: ${massNorms.map(key => `${labels[key]} ${format(norms[key],1)} г`).join(', ')}.` : '',
    missing.length ? `Задайте нормы ${missing.join(' и ')} в техкарте.` : '',
  ].filter(Boolean).join(' ')
}

function draftFields() {
  return Object.fromEntries(Array.from($('plan-form').elements)
    .filter(field => field.name).map(field => [field.name,field.type === 'checkbox' ? field.checked : field.value]))
}

function writeDrafts(records,active) {
  localStorage.setItem(draftStorageKey,JSON.stringify({records,active}))
  drafts = records
  activeDraftId = active
}

function saveDraft() {
  const id = activeDraftId || uid()
  const entry = {id,fields:draftFields(),snapshot,updated:new Date().toISOString()}
  try {
    writeDrafts([entry,...drafts.filter(item => item.id !== id)],id)
    $('form-status').textContent = snapshot ? 'Расчёт сохранён в черновик.' : 'Параметры сохранены в черновик.'
    $('form-status').classList.remove('error')
  } catch {
    $('form-status').textContent = 'Браузер не сохранил черновик.'
    $('form-status').classList.add('error')
  }
}

function needsLemonModelRefresh(calculation) {
  return calculation?.recipe.id === 'lemon' && calculation.recipe.modelRevision !== lemonModelRevision &&
    catalog.some(item => item.id === 'lemon' && item.modelRevision === lemonModelRevision)
}

function restoreDraft(entry) {
  const fields = $('plan-form').elements
  $('plan-form').reset()
  for (const [name,value] of Object.entries(entry.fields)) {
    const field = fields.namedItem(name)
    if (!field || name === 'geometryComponent') continue
    if (field.type === 'checkbox') field.checked = value
    else field.value = value
  }
  refreshPlanFields()
  if ([...$('geometry-select').options].some(option => option.value === entry.fields.geometryComponent)) {
    $('geometry-select').value = entry.fields.geometryComponent
    refreshPlanFields()
  }
  snapshot = entry.snapshot || null
  const stale = needsLemonModelRefresh(snapshot)
  if (stale && !snapshot.actualInvoice) {
    runCalculation()
    return
  }
  draw()
  saveDraft()
  if (stale) $('form-status').textContent = 'Сохранён расчёт по старой карте с фактическим расходом. Для нового плана нажмите «Рассчитать».'
}

function setDirty() {
  snapshot = null
  draw()
  saveDraft()
}

function runCalculation(store = true) {
  if (!$('plan-form').reportValidity()) return
  const plan = planFromForm()
  const recipe = currentRecipe()
  try {
    const result = calculate(plan,recipe)
    plan.shape = result.geometry ? `${shapeText(result.geometry)}, ${result.geometry.layers} сл.` : ''
    snapshot = {plan,recipe,result}
    $('form-status').textContent = ''
    $('form-status').classList.remove('error')
    draw()
    if (store) saveDraft()
  } catch (error) {
    snapshot = null
    draw()
    if (store) saveDraft()
    $('form-status').textContent = error.message
    $('form-status').classList.add('error')
  }
}

function draw() {
  if (!snapshot) {
    $('summary').innerHTML = '<h2>Результат</h2><p class="subtle">Нажмите «Рассчитать».</p>'
    $('results').hidden = true
    return
  }
  $('results').hidden = false
  const {plan,result,recipe} = snapshot
  const {predicted,geometry,finish} = result
  const metrics = [['Выход без подложки',`${format(predicted)} кг`]]
  if (geometry) metrics.push([plan.mode === 'diameter' ? 'Размер формы' : 'Расчётный размер',shapeText(geometry)])
  if (plan.guests) metrics.push(['На гостя',`${format(predicted*1000/plan.guests,0)} г`])
  const components = result.components.map(item => [componentName(item,result.components),format(item.use,1)])
  if (finish.berry) components.push(['Клубника',format(finish.berry*1000,1)])
  if (finish.extra) components.push([finish.extraName,format(finish.extra*1000,1)])
  $('summary').innerHTML = `<h2>Результат</h2>
    <dl class="summary-numbers">${metrics.map(([label,value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${geometry && plan.mode === 'suggest' ? `<p class="subtle">Цель ${format(plan.target)} кг. Размеры округлены до 0,1 см.</p>` : ''}
    ${table('Компонент','В торт, г',components)}
    ${geometry && plan.mode === 'suggest' ? '<div class="actions"><button class="button outline" id="use-diameter">Задать свои размеры</button></div>' : ''}
    ${recipe.note ? `<p class="soft-note">${html(recipe.note)}</p>` : ''}`
  $('use-diameter')?.addEventListener('click',() => {
    $('diameter').value = geometry.width
    $('length').value = geometry.length
    $('mode').value = 'diameter'
    refreshPlanFields()
    setDirty()
    $('diameter').focus()
  })
  renderResults()
}

function netWeight(item) {
  return item.basis === 'gross' ? item.measured - item.board : item.basis === 'net' ? item.measured : null
}

function caseWeight(item) {
  const net = netWeight(item)
  if (net === null) return `${format(item.measured)} кг · способ взвешивания не указан`
  return `${format(net)} кг без подложки${item.basis === 'gross' ? ` · ${format(item.measured)} кг с подложкой` : ''}`
}

function photo(item) {
  return item.photo || photoUrls.get(item.photoId)
}

function selectRecipe(id) {
  if (catalog.some(item => item.id === id)) $('recipe').value = id
}

function componentName(item, components) {
  if (!components.some(other => other !== item && other.name === item.name)) return item.name
  return `${item.name} · ${item.kind === 'coat' ? 'обтяжка' : 'прослойка'}`
}

function componentText(item) {
  const baking = item.baking
  const norm = `Выход по ТТК ${format(item.yield,1)} г. Коэффициент закладки ×${format(item.factor,4)}.`
  if (!baking) {
    const portion = item.portion
    const rule = snapshot.result.geometry && portion
      ? ` По карте Ø${format(portion.diameter,1)} см: ${format(portion.grams,1)} г ${portion.perGap ? 'на прослойку' : 'на обтяжку'}.` : ''
    return `В торт ${format(item.use,1)} г. ${norm}${rule}`
  }
  const {card,pans,layers,spare,offcuts,areaFactor,heightFactor,fill,make} = baking
  return `<p>Формы ${pans} шт., ${shapeText(baking)}. Тесто на форму ${format(fill,1)} г, всего ${format(fill*pans,1)} г. Выход ${card.trimIncluded ? 'после штатной обрезки ' : 'выпечки '}≈ ${format(make,1)} г.</p>
    <p>В торт ${layers} сл. (≈ ${format(item.use,1)} г). Запас слоёв ≈ ${format(spare,1)} г. ${card.trimIncluded ? 'Дополнительная обрезь' : 'Обрезь выбранных слоёв'} ≈ ${format(offcuts,1)} г.</p>
    <p>Коэффициент сырья: ${format(areaFactor,4)} × ${format(heightFactor,3)} × ${pans} / ${card.pans} = ${format(item.factor,4)}.</p>
    <p>Коэффициент площади ×${format(areaFactor,4)}. ${norm}</p>`
}

function scaledTable(item) {
  const rows = item.ingredients.map(([name,grams],index) => [name,format(item.sourceIngredients[index][1],1),format(grams,1)])
  const total = entries => entries.reduce((sum,[,grams]) => sum + grams,0)
  rows.push(['Итого сырья',format(total(item.sourceIngredients),1),format(total(item.ingredients),1)])
  return dataTable(['Сырьё','По ТТК, г','К замесу, г'],rows)
}

function recipeSections(role) {
  const {result} = snapshot
  const components = result.components.filter(item => item.role === role)
  const sections = components.map(item => {
    const ingredients = scaledTable(item)
    const description = `<div class="rule-note">${componentText(item)}</div>${ingredients}`
    const method = item.method ? `<p class="subtle">${html(item.method)}</p>` : ''
    return `<details open><summary>${html(componentName(item,result.components))} · ${format(item.use,1)} г в торт</summary>${description}${method}</details>`
  }).join('')
  const decor = role === 'pastry' ? [['Клубника',result.finish.berry],[result.finish.extraName,result.finish.extra]].filter(([,kg]) => kg > 0) : []
  return sections + (decor.length ? `<h3 class="summary-note">Съедобный декор</h3>${table('Наименование','В торт, г',decor.map(([name,kg]) => [name,format(kg*1000,1)]))}` : '') || '<p>Операций по этой роли нет.</p>'
}

function materialTable() {
  const rows = snapshot.actualInvoice || snapshot.result.invoice
  return table('Полуфабрикат / покупная позиция',snapshot.actualInvoice ? 'Факт, г' : 'План, г',rows.map(([name, grams]) => [name,format(grams,1)]))
}

function editMaterials() {
  const current = new Map(snapshot.actualInvoice || [])
  const rows = snapshot.result.invoice
  dialog('Фактический расход',`<p class="subtle">Сверьте каждую позицию по взвешиванию. Укажите 0, если сырьё не списывается.</p>
    <form id="actual-form"><div class="form-grid">
    ${rows.map(([name,grams],index) => `<label>${html(name)}, г <span class="optional">план ${format(grams,1)}</span><input name="material-${index}" type="number" min="0" max="10000000" step="0.1" required value="${current.get(name) ?? ''}"></label>`).join('')}
    </div><div class="actions"><button type="submit" class="button primary">Сохранить фактический расход</button></div></form>`)
  $('actual-form').onsubmit = event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    snapshot.actualInvoice = rows.map(([name],index) => [name,Number(form.get(`material-${index}`))])
    $('dialog').close()
    saveDraft()
    renderResults()
  }
}

function renderResults() {
  const {recipe, plan, result} = snapshot
  $('results').innerHTML = `<div class="section-line"><div><h2>Документы для цеха</h2><p>${html(recipe.name)} · ${format(result.predicted)} кг без подложки${plan.guests ? ` · ${format(plan.guests,0)} гостей` : ''}</p></div>
    <button class="button outline" id="save-from-plan">＋ Записать результат заказа</button></div>
    <div class="result-tabs" aria-label="Документ">${Object.entries(roleNames).map(([id,name]) => `<button type="button" data-tab="${id}" aria-pressed="${activeTab===id}">${name}</button>`).join('')}</div>
    ${activeTab === 'materials' ? `<p class="soft-note">${snapshot.actualInvoice ? 'Фактический расход.' : 'План к списанию по массе в торте. Запас выпечки учитывайте по факту.'}</p>${materialTable()}`
      : `<p class="subtle">${plan.shape ? `Форма заказа · ${html(plan.shape)}` : 'Пересчёт по выходу. Размеры форм и число замесов задаёт цех.'}</p>
      ${recipeSections(activeTab)}`}
    ${recipe.source ? `<p class="subtle">Источники · ${html(recipe.source)}</p>` : ''}
    <div class="actions"><button type="button" class="button outline" id="print-doc">Печать / PDF</button>${activeTab === 'materials' ? '<button type="button" class="button outline" id="edit-materials">Внести фактический расход</button><button type="button" class="button primary" id="csv">Скачать CSV</button>' : ''}</div>`
  for (const button of $('results').querySelectorAll('[data-tab]')) button.onclick = () => {
    activeTab = button.dataset.tab
    renderResults()
    $('results').querySelector(`[data-tab="${activeTab}"]`).focus()
  }
  $('print-doc').onclick = printDocument
  $('csv')?.addEventListener('click', exportMaterials)
  $('edit-materials')?.addEventListener('click', editMaterials)
  $('save-from-plan').onclick = () => editCase(null, snapshot)
}

function printDocument() {
  const {plan,recipe,result} = snapshot
  const invoice = activeTab === 'materials'
  const components = result.components.filter(item => item.role === activeTab)
  const printRows = components.flatMap(item => {
    const baking = item.baking
    const forms = baking ? `, ${baking.pans} шт. × ${shapeText(baking)}, тесто ${format(baking.fill,1)} г/шт., выход${baking.card.trimIncluded ? ' после обрезки' : ''} ${format(baking.make,1)} г` : ''
    return [[`${componentName(item,result.components)} · в торт ${format(item.use,1)} г${forms}`,''],
      ...item.ingredients.map(([name,grams]) => [name,format(grams,1)])]
  })
  if (activeTab === 'pastry') {
    if (result.finish.berry) printRows.push(['Клубника свежая',format(result.finish.berry*1000,1)])
    if (result.finish.extra) printRows.push([result.finish.extraName,format(result.finish.extra*1000,1)])
  }
  $('printout').innerHTML = `<h1>${invoice ? (snapshot.actualInvoice ? 'Расходная накладная' : 'Плановая накладная') : roleNames[activeTab]}</h1>
    <p>${html(recipe.name)} · ${format(result.predicted)} кг${plan.shape ? ` · ${html(plan.shape)}` : ''}</p>
    ${invoice ? materialTable() : table('Полуфабрикат / сырьё','Закладка, г',printRows)}
    ${invoice ? '<p>Выдал ____________________ &emsp; Принял ____________________</p>' : ''}`
  window.print()
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportMaterials() {
  const {result, recipe} = snapshot
  const quote = value => {
    const string = String(value)
    return '"' + (/^[=+@\-\s]/.test(string) ? "'" : '') + string.replaceAll('"','""') + '"'
  }
  const amount = value => (Math.round(value * 10) / 10).toString().replace('.',',')
  const actual = snapshot.actualInvoice
  const content = [[actual ? 'Расходная накладная' : 'Плановая расходная накладная',recipe.name],['Расчётный вес торта, кг',amount(result.predicted)],['Полуфабрикат / покупная позиция','Ед. изм.',actual ? 'Факт' : 'План'],
    ...(actual || result.invoice).map(([name, grams]) => [name,'г',amount(grams)])].map(row => row.map(quote).join(';')).join('\r\n')
  download(new Blob(['\ufeff',content],{type:'text/csv;charset=utf-8'}),actual ? 'расходная-накладная.csv' : 'плановая-расходная-накладная.csv')
}

function dialog(title, body) {
  $('dialog-title').textContent = title
  $('dialog-body').innerHTML = body
  if (!$('dialog').open) $('dialog').showModal()
}

function viewCase(item) {
  const recipe = catalog.find(recipe => recipe.id === item.recipe)
  dialog(item.name,`<p>${html(recipe?.name)} · ${caseWeight(item)}</p>
    <p class="subtle">${html(item.date || '')}${item.date ? ' · ' : ''}Подложка ${format(item.board)} кг</p>
    <p class="subtle">${html(item.shape || '')}</p>
    <p class="subtle">${html(item.notes || '')}</p>
    <p class="summary-note">${item.coat == null ? 'Расход крема не указан' : `Крем ${format(item.coat)} кг`} · ${item.berry == null ? 'Расход ягод не указан' : `Клубника ${format(item.berry)} кг`}</p>
    ${item.baked != null || item.filling != null ? `<p class="subtle">${[item.baked != null && `Коржи в торте ${format(item.baked)} кг`,item.filling != null && `Начинка в торте ${format(item.filling)} кг`].filter(Boolean).join(' · ')}</p>` : ''}
    ${item.plan ? `<p class="subtle">План ${format(item.plan.target)} кг${item.plan.guests ? ` · ${format(item.plan.guests,0)} гостей` : ''}${netWeight(item) !== null ? ` · отклонение ${format(netWeight(item)-item.plan.target)} кг` : ''}</p>` : ''}
    ${item.plannedComponents ? table('Компонент по плану','В торт, г',item.plannedComponents.map(([name,grams]) => [name,format(grams,1)])) : ''}
    ${item.actualMaterials ? `<details><summary>Фактический расход</summary>${table('Сырьё','Факт, г',item.actualMaterials.map(([name,grams]) => [name,format(grams,1)]))}</details>` : ''}
    ${item.actualInvoice ? `<details><summary>Расход по полуфабрикатам</summary>${table('Позиция','Факт, г',item.actualInvoice.map(([name,grams]) => [name,format(grams,1)]))}</details>` : ''}
    ${item.source ? `<p class="subtle">Источник · ${html(item.source)}</p>` : ''}
    <div class="actions"><button class="button outline" id="edit-case">Редактировать</button></div>`)
  $('edit-case').onclick = () => editCase(item)
}

function renderHistory() {
  $('drafts-list').innerHTML = drafts.length ? drafts.map(entry => {
    const name = entry.snapshot?.recipe.name || catalog.find(item => item.id === entry.fields.recipe)?.name || 'Заказ'
    const stale = needsLemonModelRefresh(entry.snapshot)
    const kg = stale ? null : entry.snapshot?.result.predicted ?? (entry.fields.mode === 'diameter' ? null : Number(entry.fields.target))
    const status = stale ? 'Расчёт по прежней карте' : entry.snapshot ? 'Расчёт готов' : 'Параметры заказа'
    const updated = new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.updated))
    return `<div class="file-row"><div><strong>${html(name)}${kg ? ` · ${format(kg)} кг` : ''}</strong><div class="subtle">${status} · ${updated}</div></div><button class="button outline" data-draft="${html(entry.id)}">Открыть черновик</button></div>`
  }).join('') : '<p class="subtle">Черновиков пока нет.</p>'
  for (const button of $('drafts-list').querySelectorAll('[data-draft]')) button.onclick = () => {
    const entry = drafts.find(item => item.id === button.dataset.draft)
    activeDraftId = entry.id
    restoreDraft(entry)
    showPage('calc')
  }
  $('history-list').innerHTML = history.map(item => {
    const picture = photo(item)
    return `<article class="panel case-card">
      ${picture ? `<img src="${html(picture)}" alt="${html(item.name)}">` : ''}
      <div class="case-body">
        <h2>${html(item.name)}</h2><p><strong>${caseWeight(item)}</strong></p>
        ${item.shape ? `<p class="subtle">${html(item.shape)}</p>` : ''}${item.notes ? `<p class="subtle">${html(item.notes)}</p>` : ''}
        <div class="actions"><button class="button outline" data-case="${html(item.id)}">Открыть запись</button></div>
      </div></article>`
  }).join('')
  for (const button of $('history-list').querySelectorAll('[data-case]')) {
    button.onclick = () => viewCase(history.find(item => item.id === button.dataset.case))
  }
}

function editCase(item, calculation) {
  const plan = calculation ? {...calculation.plan,target:calculation.result.predicted} : undefined
  const draftId = calculation ? activeDraftId : null
  const date = new Date()
  const today = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  const display = item || {name:'',recipe:plan?.recipe || $('recipe').value,date:today,board:plan?.board ?? 0,shape:plan?.shape ?? ''}
  const quantity = (label,name,required = false,min = 0) => `<label>${label}<input name="${name}" type="number" min="${min}" max="1000" step="any" value="${html(display[name])}" ${required ? 'required' : ''}></label>`
  dialog(item ? 'Редактировать заказ' : 'Записать результат заказа',`
    <form id="case-form"><div class="form-grid">
      <label class="full">Название<input name="name" maxlength="120" required value="${html(display.name)}"></label>
      <label>Рецептура<select name="recipe">${recipeOptions(display.recipe)}</select></label>
      <label>Дата заказа<input name="date" type="date" value="${html(display.date)}"></label>
      ${quantity('Вес по факту, кг','measured',true,.001)}
      <label>Как взвесили<select name="basis">
        ${[['net','Без подложки'],['gross','С подложкой'],['unknown','Способ неизвестен']].map(([key,label]) => `<option value="${key}" ${display.basis===key?'selected':''}>${label}</option>`).join('')}
      </select></label>
      ${quantity('Подложка, кг','board',true)}${quantity('Крем по факту, кг','coat')}${quantity('Клубника по факту, кг','berry')}
      ${quantity('Коржи в торте, кг','baked')}${quantity('Начинка в торте, кг','filling')}
      <label class="full">Форма, размеры и число коржей<input name="shape" maxlength="250" value="${html(display.shape)}"></label>
      <label class="full">Что получилось и что исправить<textarea name="notes" rows="3" maxlength="2500">${html(display.notes)}</textarea></label>
      <label class="full">Фото торта<input name="photo" type="file" accept="image/*"></label>
    </div><div class="actions"><button class="button primary" type="submit">Сохранить в историю</button></div>
    <p class="error" id="dialog-error" role="alert"></p></form>`)
  $('case-form').onsubmit = async event => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value = field => values.get(field).trim()
    const numberOrNull = field => value(field) === '' ? null : Number(value(field))
    const record = {...item,id:item?.id || uid(),plan:item?.plan || plan,
      plannedComponents:item?.plannedComponents || calculation?.result.components.map(entry => [componentName(entry,calculation.result.components),entry.use]),
      actualMaterials:item?.actualMaterials,actualInvoice:item?.actualInvoice || calculation?.actualInvoice,recipe:value('recipe'),name:value('name'),date:value('date'),
      measured:Number(value('measured')),basis:value('basis'),board:Number(value('board')),coat:numberOrNull('coat'),berry:numberOrNull('berry'),baked:numberOrNull('baked'),filling:numberOrNull('filling'),shape:value('shape'),notes:value('notes')}
    const net = netWeight(record)
    if (!record.name || (net !== null && net <= 0)) {
      $('dialog-error').textContent = record.name ? 'Вес вместе с подложкой должен быть больше веса подложки.' : 'Укажите название заказа.'
      return
    }
    const file = values.get('photo')
    const button = event.submitter
    button.disabled = true
    try {
      if (file.size) {
        if (!file.type.startsWith('image/')) throw new Error('Выберите изображение.')
        if (file.size > 20 * 1024 * 1024) throw new Error('Размер фото должен быть до 20 МБ.')
        record.photoId = uid()
        delete record.photo
        await fileAction('put',{id:record.photoId,file,group:'case'})
        photoUrls.set(record.photoId,URL.createObjectURL(file))
      }
      persist(catalog, item ? history.map(entry => entry.id === item.id ? record : entry) : [record,...history])
      if (draftId) {
        try { writeDrafts(drafts.filter(entry => entry.id !== draftId),null) }
        catch { $('form-status').textContent = 'Готовый заказ записан. Черновик остался в истории.' }
      }
      $('dialog').close()
      if (snapshot) draw()
      showPage('history')
    } catch (error) {
      $('dialog-error').textContent = error.message || 'Не удалось сохранить заказ в браузере.'
      button.disabled = false
    }
  }
}

function renderLibrary() {
  $('library-list').innerHTML = catalog.map(recipe => `<section class="panel"><div class="section-line"><div><h2>${html(recipe.name)}</h2><p>${html(recipe.source)}</p></div><button class="button outline" data-recipe="${html(recipe.id)}">Редактировать</button></div>
    ${recipe.note ? `<p class="subtle">${html(recipe.note)}</p>` : ''}
    ${recipe.components.map((item,index) => `<details><summary>${html(componentName(item,recipe.components))} · выход ${format(item.yield)} г</summary>
      ${item.kind === 'core' ? `<p class="subtle">Доля в базовой сборке ${format(item.share)} г</p>` : '<p class="subtle">Обтяжка по введённому весу</p>'}
      ${item.portion ? `<p class="subtle">Норма Ø${format(item.portion.diameter,1)} см · ${format(item.portion.grams,1)} г ${item.portion.perGap ? 'на прослойку' : 'на обтяжку'}</p>` : ''}
      ${geometryCard(item) ? `<p class="subtle">Формовка по ТТК: ${geometryCard(item).pans} шт., ${shapeText(geometryCard(item))}, по ${format(geometryCard(item).fill,1)} г теста.</p>` : ''}
      ${table('Сырьё','Норма, г',item.ingredients.map(([name, grams]) => [name,format(grams)]))}
      <div class="actions"><button class="button outline" data-scale-recipe="${html(recipe.id)}" data-scale-index="${index}">Пересчитать полуфабрикат</button></div>
    </details>`).join('')}</section>`).join('')
  for (const button of $('library-list').querySelectorAll('[data-recipe]')) {
    button.onclick = () => editRecipe(catalog.find(item => item.id === button.dataset.recipe))
  }
  for (const button of $('library-list').querySelectorAll('[data-scale-recipe]')) {
    button.onclick = () => {
      const recipe = catalog.find(item => item.id === button.dataset.scaleRecipe)
      scaleComponent(recipe.components[Number(button.dataset.scaleIndex)])
    }
  }
  renderFiles()
}

function scaleComponent(item) {
  const card = geometryCard(item)
  dialog(item.name, `<form id="scale-form"><div class="form-grid">
    <label>Нужный выход, г<input name="output" type="number" min="0.001" max="10000000" step="any" required value="${item.yield}"></label>
    ${card ? `<label>Режим<select name="scaleMode"><option value="mass">По выходу</option><option value="diameter">По размерам и числу форм</option></select></label>
      <div class="form-grid full" id="scale-geometry" hidden>
        <label>${card.shape === 'round' ? 'Диаметр' : 'Ширина'} формы, см<input name="diameter" type="number" min="1" max="200" step="0.1" disabled required value="${card.width}"></label>
        ${card.shape !== 'round' ? `<label>Длина формы, см<input name="length" type="number" min="1" max="200" step="0.1" disabled required value="${card.length}"></label>` : ''}
        <label>Число форм<input name="pans" type="number" min="1" max="100" step="1" disabled required value="${card.pans}"></label>
        <label>Толщина относительно техкарты, ×<input name="thickness" type="number" min="0.1" max="5" step="any" disabled required value="1"></label>
      </div>` : ''}
    </div><div class="actions"><button type="submit" class="button primary">Пересчитать</button></div></form>
    <div id="scale-result" aria-live="polite"></div>`)
  const form = $('scale-form')
  form.oninput = () => {
    $('scale-result').innerHTML = ''
    if (!card) return
    const geometry = form.elements.scaleMode.value === 'diameter'
    form.elements.output.disabled = geometry
    form.elements.output.closest('label').hidden = geometry
    $('scale-geometry').hidden = !geometry
    for (const field of $('scale-geometry').querySelectorAll('input')) field.disabled = !geometry
  }
  form.onsubmit = event => {
    event.preventDefault()
    const inputs = new FormData(form)
    const geometry = inputs.get('scaleMode') === 'diameter'
    const factor = geometry
      ? bakingFactor(card,shapeArea(card.shape,Number(inputs.get('diameter')),Number(inputs.get('length'))),Number(inputs.get('thickness')),Number(inputs.get('pans')))
      : Number(inputs.get('output')) / item.yield
    const fill = geometry ? card.fill * factor * card.pans / Number(inputs.get('pans')) : 0
    $('scale-result').innerHTML = `<p class="rule-note">Выход ≈ ${format(item.yield*factor,1)} г. Коэффициент сырья ×${format(factor,4)}.${geometry ? ` Тесто на форму ${format(fill,1)} г.` : ''}</p>
      ${scaledTable({sourceIngredients:item.ingredients,ingredients:scaleIngredients(item,factor)})}`
  }
}

function editorComponent(item, index) {
  const card = geometryCard(item)
  return `<fieldset class="dialog-component">
    <legend>Компонент ${index + 1}</legend><div class="form-grid">
      <label class="full">Название<input name="name" maxlength="100" required value="${html(item.name)}"></label>
      <label>Назначение<select name="kind"><option value="core">Основа и начинка</option><option value="coat" ${item.kind==='coat'?'selected':''}>Обтяжка</option></select></label>
      <label>Исполнитель<select name="role"><option value="pastry">Кондитер</option><option value="baker" ${item.role==='baker'?'selected':''}>Пекарь</option></select></label>
      <label>Общий выход техкарты, г<input type="number" name="yield" min="0.001" max="10000000" step="any" required value="${html(item.yield)}"></label>
      <label>В базовой сборке, г<input type="number" name="share" min="0.001" max="10000000" step="any" value="${item.kind === 'coat' ? '' : html(item.share)}"></label>
      <label class="full">Сырьё и масса, г<textarea name="ingredients" required rows="4" maxlength="30000" placeholder="Мука пшеничная ВС = 200">${html(item.ingredients?.map(([name, grams]) => `${name} = ${grams}`).join('\n'))}</textarea></label>
      <p class="field-info full">Вставьте из Excel два столбца с названием и массой в граммах. Для CSV с разделителем «точка с запятой» выберите единицу исходных масс и загрузите файл.</p>
      <label>Единица в CSV<select name="csv-unit"><option value="1">г</option><option value="1000">кг</option></select></label>
      <div class="actions"><label class="button outline file-button">Загрузить сырьё из CSV<input name="csv-file" type="file" accept=".csv,.tsv,text/csv"></label></div>
      <p class="full import-status" role="status" hidden></p>
      <label class="full">Технология приготовления<textarea name="method" rows="2" maxlength="5000">${html(item.method)}</textarea></label>
    </div>
    <details class="form-section" ${card ? 'open' : ''}>
      <summary>Эталонная форма коржей</summary>
      <p class="subtle">Укажите размеры и закладку одной формы. Общий выход выше должен соответствовать всей партии.</p>
      <div class="form-grid">
        <label>Форма<select name="base-shape"><option value="round">Круг</option><option value="oval" ${card?.shape === 'oval' ? 'selected' : ''}>Овал</option><option value="rectangle" ${card?.shape === 'rectangle' ? 'selected' : ''}>Прямоугольник</option></select></label>
        <label><span class="base-width-label">Исходный диаметр, см</span><input type="number" name="base-diameter" min="1" max="200" step="any" value="${html(card?.width)}"></label>
        <label>Исходная длина, см<input type="number" name="base-length" min="1" max="200" step="any" value="${html(card?.shape !== 'round' ? card?.length : '')}"></label>
        <label>Число форм в партии по ТТК<input type="number" name="base-pans" min="1" max="100" step="1" value="${html(card?.pans)}"></label>
        <label>Тесто на форму, г<input type="number" name="base-fill" min="0.001" max="10000000" step="any" value="${html(card?.fill)}"></label>
        <label>Слоёв из одной формы<input type="number" name="base-layers" min="1" max="30" step="1" value="${html(card?.layers)}"></label>
        <label class="full"><input type="checkbox" name="trim-included" ${card?.trimIncluded ? 'checked' : ''}> Выход уже указан после штатной обрезки</label>
      </div>
    </details>
    <details class="form-section" ${item.portion ? 'open' : ''}>
      <summary>Норма крема по диаметру</summary>
      <p class="subtle">Для начинки укажите массу на одну прослойку. Для обтяжки укажите массу на весь торт этого диаметра.</p>
      <div class="form-grid">
        <label>Эталонный диаметр, см<input type="number" name="portion-diameter" min="1" max="200" step="any" value="${html(item.portion?.diameter)}"></label>
        <label>Норма крема, г<input type="number" name="portion-grams" min="0.001" max="10000000" step="any" value="${html(item.portion?.grams)}"></label>
      </div>
    </details>
    <div class="actions"><button type="button" class="button outline remove-component">Убрать компонент</button></div></fieldset>`
}

function updateEditorShape(field) {
  const round = field.querySelector('[name="base-shape"]').value === 'round'
  const length = field.querySelector('[name="base-length"]')
  length.disabled = round
  length.closest('label').hidden = round
  field.querySelector('.base-width-label').textContent = round ? 'Исходный диаметр, см' : 'Исходная ширина, см'
}

function editRecipe(recipe) {
  const norms = recipe ? finishNorms(recipe) : {}
  const initial = recipe?.components || [{}]
  dialog(recipe ? 'Редактировать рецептуру' : 'Добавить рецептуру', `<form id="recipe-form">
    <div class="form-grid"><label class="full">Название рецептуры<input id="recipe-name" maxlength="100" required value="${html(recipe?.name)}"></label>
    <label class="full">Источник<input id="recipe-source" maxlength="240" placeholder="Название файла или номер ТТК" value="${html(recipe?.source)}"></label>
    <label class="full">Примечание к сборке<textarea id="edit-recipe-note" rows="2" maxlength="2000">${html(recipe?.note)}</textarea></label></div>
    <fieldset class="dialog-component"><legend>Нормы отделки на 1 кг основы</legend><div class="form-grid">
      <label>Крем для обтяжки, г<input id="norm-coat" type="number" min="0" max="5000" step="any" value="${norms.coat || 0}" required></label>
      <label>Клубника, г<input id="norm-berry" type="number" min="0" max="5000" step="any" value="${norms.berry || 0}" required></label>
      <label>Название другого декора<input id="norm-extra-name" maxlength="100" value="${html(norms.extraName)}"></label>
      <label>Другой декор, г<input id="norm-extra" type="number" min="0" max="5000" step="any" value="${norms.extra || 0}" required></label>
    </div></fieldset>
    <div id="component-editor">${initial.map(editorComponent).join('')}</div><div class="actions">
    <button type="button" class="button outline" id="add-component">＋ Компонент</button>
    <button type="submit" class="button primary">Сохранить рецептуру</button></div>
    <p id="dialog-error" class="error" role="alert"></p></form>`)
  const editor = $('component-editor')
  $('recipe-form').addEventListener('invalid',event => {
    const section = event.target.closest('details')
    if (section) section.open = true
  },true)
  for (const field of editor.children) updateEditorShape(field)
  let next = initial.length
  $('add-component').onclick = () => {
    editor.insertAdjacentHTML('beforeend',editorComponent({},next++))
    updateEditorShape(editor.lastElementChild)
    editor.lastElementChild.querySelector('input').focus()
  }
  editor.onclick = event => {
    if (event.target.matches('.remove-component')) event.target.closest('fieldset').remove()
  }
  editor.onchange = async event => {
    const input = event.target
    if (input.name === 'base-shape') updateEditorShape(input.closest('fieldset'))
    if (input.name !== 'csv-file' || !input.files?.length) return
    const field = input.closest('fieldset')
    const status = field.querySelector('.import-status')
    const file = input.files[0]
    status.hidden = false
    input.disabled = true
    try {
      if (file.size > 100000) throw new Error('CSV с массами сырья должен быть до 100 КБ.')
      const unit = Number(field.querySelector('[name="csv-unit"]').value)
      const rows = parseIngredients(await file.text(),unit)
      if (!rows.length) throw new Error('В CSV нет строк с сырьём.')
      const ingredients = rows.map(([name,grams]) => `${name} = ${grams}`).join('\n')
      if (ingredients.length > 30000) throw new Error('В CSV слишком много строк для одного компонента.')
      field.querySelector('[name="ingredients"]').value = ingredients
      status.textContent = `Загружено позиций: ${rows.length}. Проверьте массы перед сохранением.`
      status.classList.remove('error')
    } catch (error) {
      status.textContent = error.message
      status.classList.add('error')
    } finally {
      input.value = ''
      input.disabled = false
    }
  }
  $('recipe-form').onsubmit = event => {
    event.preventDefault()
    try {
      const fields = [...editor.children]
      const components = fields.map(field => {
        const value = name => field.querySelector(`[name="${name}"]`).value.trim()
        const kind = value('kind')
        const name = value('name')
        const baseYield = Number(value('yield'))
        const share = Number(value('share'))
        if (!name || (kind === 'core' && !share)) throw new Error('Укажите название и вес в базовой сборке для каждого компонента основы.')
        const ingredients = parseIngredients(value('ingredients'))
        if (!ingredients.some(([, grams]) => grams > 0)) throw new Error(`Добавьте сырьё для «${name}».`)
        const [width,pans,fill,layers] = ['base-diameter','base-pans','base-fill','base-layers'].map(key => Number(value(key)))
        const shape = value('base-shape')
        const length = shape === 'round' ? width : Number(value('base-length'))
        const numbers = [width,length,pans,fill,layers]
        if (numbers.some(Boolean) && (kind !== 'core' || numbers.some(number => !number))) {
          throw new Error(`Для «${name}» заполните размеры, число форм, закладку и число слоёв. Форма относится к компонентам основы.`)
        }
        if (width && (ingredients.reduce((sum,[,grams]) => sum + grams,0) + 0.1 < fill*pans || baseYield > fill*pans + 0.1)) {
          throw new Error(`Для «${name}» сверьте массы. Сырья должно хватить на все формы, а выход не должен превышать закладку теста.`)
        }
        const trimIncluded = field.querySelector('[name="trim-included"]').checked
        if (trimIncluded && !width) throw new Error(`Для «${name}» укажите эталонную форму, чтобы учесть обрезку.`)
        const batch = width ? {shape,width,length,pans,fill,layers,trimIncluded} : undefined
        const diameter = Number(value('portion-diameter'))
        const grams = Number(value('portion-grams'))
        if (Boolean(diameter) !== Boolean(grams) || (diameter && batch)) {
          throw new Error(`Для «${name}» укажите и диаметр, и массу крема. Норма относится к компоненту крема.`)
        }
        const portion = diameter ? {diameter,grams,perGap:kind === 'core'} : undefined
        return {name,role:value('role'),kind,share,yield:baseYield,ingredients,method:value('method'),batch,portion}
      })
      const name = $('recipe-name').value.trim()
      if (!name) throw new Error('Укажите название рецептуры.')
      if (!components.some(item => item.kind === 'core') || components.filter(item => item.kind === 'coat').length > 1) {
        throw new Error('Добавьте хотя бы один компонент основы. Карту обтяжки можно указать одну.')
      }
      const finish = {coat:Number($('norm-coat').value),berry:Number($('norm-berry').value),extra:Number($('norm-extra').value),extraName:$('norm-extra-name').value.trim()}
      if (finish.coat && !components.some(item => item.kind === 'coat')) throw new Error('Для нормы обтяжки укажите компонент крема.')
      if (finish.extra && !finish.extraName) throw new Error('Укажите название другого декора.')
      const record = {id:recipe?.id || uid(),modelRevision:recipe?.modelRevision,name,finish, source:$('recipe-source').value.trim(), note:$('edit-recipe-note').value.trim(), components}
      persist(recipe ? catalog.map(item => item.id === recipe.id ? record : item) : [...catalog,record],history)
      $('recipe').innerHTML = recipeOptions($('recipe').value)
      refreshPlanFields()
      if (currentRecipe().id === record.id && !activeDraftId) { snapshot = null; draw() }
      $('dialog').close()
      renderLibrary()
    } catch (error) {
      $('dialog-error').textContent = error.message || 'Не удалось сохранить рецептуру.'
    }
  }
}

async function renderFiles() {
  const defaults = originalFiles.map(([name,file]) => `<div class="file-row"><span>${html(name)}</span><a class="button outline" href="../files/${html(file)}" target="_blank" rel="noopener">Оригинал</a></div>`).join('')
  $('file-list').innerHTML = defaults
  try {
    const files = (await fileAction('getAll')).filter(item => item.group === 'source')
    $('file-list').innerHTML += files.map(item => `<div class="file-row"><span>${html(item.file.name)}</span><button class="button outline" data-file="${html(item.id)}">Скачать</button></div>`).join('')
    for (const button of $('file-list').querySelectorAll('[data-file]')) {
      button.onclick = () => {
        const record = files.find(item => item.id === button.dataset.file)
        download(record.file,record.file.name)
      }
    }
  } catch {
    $('file-list').insertAdjacentHTML('beforeend','<p class="subtle">Хранилище вложений недоступно в этом браузере.</p>')
  }
}

$('source-file').onchange = async event => {
  const input = event.target
  input.disabled = true
  const files = [...input.files]
  let added = 0
  try {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) throw new Error(`Файл «${file.name}» превышает 20 МБ.`)
      await fileAction('put',{id:uid(),file,group:'source'})
      added++
    }
    $('files-status').textContent = `Прикреплено файлов: ${added}.`
  } catch (error) {
    $('files-status').textContent = `Сохранено файлов: ${added}. ${error.message || 'Хранилище недоступно.'}`
  } finally {
    input.value = ''
    input.disabled = false
    renderFiles()
  }
}

for (const button of document.querySelectorAll('[data-page]')) button.onclick = () => showPage(button.dataset.page)
$('dialog-close').onclick = () => $('dialog').close()
$('add-case').onclick = () => editCase(null)
$('add-recipe').onclick = () => editRecipe(null)
$('plan-form').addEventListener('invalid',event => {
  const section = event.target.closest('details')
  if (section) section.open = true
},true)
$('plan-form').onsubmit = event => {
  event.preventDefault()
  runCalculation()
}
$('plan-form').oninput = event => {
  const id = event.target.id
  const finishChanged = ['coat','berry','extra'].includes(id)
  if (['recipe','mode','geometry-select','shape-type'].includes(id) || finishChanged) refreshPlanFields()
  if (finishChanged && snapshot) runCalculation()
  else setDirty()
}
$('reset').onclick = () => {
  $('plan-form').reset()
  selectRecipe('lemon')
  $('target').value = ''
  $('diameter').value = ''
  try { writeDrafts(drafts,null) }
  catch { activeDraftId = null }
  activeTab = 'baker'
  refreshPlanFields()
  snapshot = null
  draw()
  $('form-status').textContent = ''
  $('target').focus()
}
$('recipe').innerHTML = recipeOptions('lemon')
$('save-draft').onclick = saveDraft
refreshPlanFields()
const lastDraft = drafts.find(entry => entry.id === activeDraftId)
if (lastDraft) restoreDraft(lastDraft)
else runCalculation(false)
fileAction('getAll').then(files => {
  for (const item of files.filter(item => item.group === 'case')) photoUrls.set(item.id,URL.createObjectURL(item.file))
  if (!$('history').hidden) renderHistory()
}).catch(() => {})
