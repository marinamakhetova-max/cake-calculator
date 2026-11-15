function shapeArea(shape, width, length = width) {
  return shape === 'rectangle' ? width * length : Math.PI * width * (shape === 'round' ? width : length) / 4
}

function geometryCard(item) {
  if (!item.batch) return null
  const {fill, output} = item.batch
  const shape = item.batch.shape || 'round'
  const width = item.batch.width ?? item.batch.diameter
  const length = shape === 'round' ? width : item.batch.length
  const pans = item.batch.pans ?? Math.round(item.yield / output)
  const layers = item.batch.layers ?? 2
  if (![width,length,fill,pans,layers].every(value => Number.isFinite(value) && value > 0)) return null
  return {shape,width,length,diameter:shape === 'round' ? width : null,area:shapeArea(shape,width,length),fill,pans,layers,output:item.yield/pans,trimIncluded:Boolean(item.batch.trimIncluded)}
}

function geometryComponents(recipe) {
  return recipe.components.map((item,index) => ({item,index,card:geometryCard(item)}))
    .filter(({item,card}) => item.kind === 'core' && card)
}

function bakingFactor(card, area, thickness, pans) {
  return area / card.area * thickness * pans / card.pans
}

function scaleIngredients(item, factor) {
  return item.ingredients.map(([name,base]) => [name,base*factor])
}

function finishNorms(recipe) {
  return recipe.finish ?? recipes.find(item => item.id === recipe.id)?.finish ?? {}
}

function portionGrams(portion, area, layers) {
  return portion.grams * area/shapeArea('round',portion.diameter) * (portion.perGap ? Math.max(0,layers-1) : 1)
}

function calculate(plan, recipe) {
  const core = recipe.components.filter(item => item.kind === 'core')
  const coreShare = core.reduce((sum,item) => sum+item.share,0)
  if (!coreShare) throw new Error('У рецептуры нет компонентов основы.')
  const norms = finishNorms(recipe)
  const rates = Object.fromEntries(['coat','berry','extra'].map(key => [key,plan[key+'Enabled'] ? (norms[key] || 0)/1000 : 0]))
  const coatCard = recipe.components.find(item => item.kind === 'coat')
  let geometry = null
  let coreKg = plan.target / (1+rates.coat+rates.berry+rates.extra)
  let coatKg = coreKg*rates.coat
  let coreGrams = item => coreKg*1000*item.share/coreShare
  let anchor

  if (plan.mode !== 'diameter' && !(coreKg > 0)) throw new Error('Введите целевой вес торта.')
  if (plan.mode !== 'mass') {
    anchor = geometryComponents(recipe).find(({index}) => index === plan.geometryComponent)
    if (!anchor) throw new Error('Для расчёта формы добавьте эталонные размеры и выход коржей в техкарту.')
    const {item:anchorItem,card} = anchor
    const layers = plan.layers
    const pans = Math.ceil(layers/card.layers)
    const useFraction = layers/(pans*card.layers)*(1-plan.trim/100)
    const heightFactor = plan.thickness
    const shape = plan.shapeType
    const anchorPerArea = card.output*pans*useFraction*heightFactor/card.area
    const coreAt = (item,area) => item !== anchorItem && item.portion
      ? portionGrams(item.portion,area,layers)
      : anchorPerArea*area*item.share/anchorItem.share
    const coatAt = (area,baseKg) => rates.coat && coatCard?.portion
      ? portionGrams(coatCard.portion,area,layers)/1000
      : baseKg*rates.coat
    const basePerArea = core.reduce((sum,item) => sum+coreAt(item,1)/1000,0)
    let width = plan.diameter
    let length = shape === 'round' ? width : plan.length
    if (plan.mode === 'suggest') {
      const kgPerArea = basePerArea*(1+rates.berry+rates.extra)+coatAt(1,basePerArea)
      const area = plan.target/kgPerArea
      const ratio = shape === 'round' ? 1 : plan.ratio
      const rawWidth = Math.sqrt(area/shapeArea(shape,1,ratio))
      width = Math.round(rawWidth*10)/10
      length = Math.round(rawWidth*ratio*10)/10
    }
    if (![width,length].every(value => value >= 1 && value <= 200)) {
      throw new Error('Размер формы вне диапазона 1–200 см. Сверьте число слоёв и параметры формы.')
    }
    const area = shapeArea(shape,width,length)
    const areaFactor = area/card.area
    const panFactor = areaFactor*heightFactor
    const make = pans*card.output*panFactor
    const use = make*useFraction
    coreGrams = item => coreAt(item,area)
    coreKg = basePerArea*area
    coatKg = coatAt(area,coreKg)
    geometry = {shape,width,length,diameter:shape === 'round' ? width : null,pans,layers,card,use,make,areaFactor,heightFactor,
      fill:card.fill*panFactor,spare:make*(1-layers/(pans*card.layers)),offcuts:make*layers/(pans*card.layers)*plan.trim/100,
      factor:bakingFactor(card,area,heightFactor,pans)}
  }

  const finish = {coat:coatKg,berry:coreKg*rates.berry,extra:coreKg*rates.extra,extraName:norms.extraName || ''}
  const invoice = new Map()
  const add = (name,grams) => invoice.set(name,(invoice.get(name) || 0)+grams)
  const components = recipe.components.map((item,index) => {
    const use = item.kind === 'coat' ? finish.coat*1000 : coreGrams(item)
    const baking = geometry && index === anchor.index ? geometry : null
    const make = baking ? baking.make : use
    const factor = baking ? baking.factor : use/item.yield
    return {...item,use,make,factor,baking,sourceIngredients:item.ingredients,ingredients:scaleIngredients(item,factor)}
  }).filter(item => item.use > 0)
  for (const item of components) add(item.name,item.use)
  if (finish.berry) add('Клубника свежая',finish.berry*1000)
  if (finish.extra) add(finish.extraName,finish.extra*1000)
  return {coreKg,predicted:coreKg+finish.coat+finish.berry+finish.extra,geometry,components,finish,invoice:[...invoice]}
}

function parseIngredients(text, gramsPerUnit = 1) {
  const rows = text.replace(/^\ufeff/,'').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const nameHeader = /^(?:сырь[её]|ингредиент|наименование(?: сырья)?)$/iu
  const weightHeader = /^(?:(?:масса|вес|количество|норма|нетто)[ ,()]*|граммы)?(?:г|кг)?\)*$/iu
  const unquote = value => value.trim().replace(/^"(.*)"$/, '$1').replaceAll('""','"').trim()
  return rows.flatMap((line,index) => {
    const pair = line.match(/^(.*?)[\t;=]\s*([^;\t=]+)$/u)
    if (!pair) throw new Error(`Строка ${index+1}. Нужны два столбца: наименование и масса.`)
    const name = unquote(pair[1])
    const value = unquote(pair[2])
    if (index === 0 && nameHeader.test(name) && value && weightHeader.test(value)) {
      const label = value.toLowerCase().replace(/[()]/g,'').split(/[ ,]+/).at(-1)
      if ((label === 'кг' && gramsPerUnit !== 1000) || (label === 'г' && gramsPerUnit !== 1)) {
        throw new Error('Единица в заголовке не совпадает с выбранной единицей исходных масс.')
      }
      return []
    }
    const mass = Number(value.replace(',','.')) * gramsPerUnit
    if (!name || /[\t;=]/u.test(name) || !/^\d+(?:[.,]\d+)?$/u.test(value) || !Number.isFinite(mass) || mass > 1e7) {
      throw new Error(`Строка ${index+1}. Проверьте наименование и массу «${line}».`)
    }
    return [[name,mass]]
  })
}
