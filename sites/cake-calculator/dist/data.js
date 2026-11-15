const lemonFillingPortion = {diameter:18,grams:200,perGap:true}
// At Ø20 cm the Ø18 cm norm of 467 g gives about 576 g of butter cream.
const lemonCoatingPortion = {diameter:18,grams:467}
const lemonCoatingRate = lemonCoatingPortion.grams*1000/1022
const lemonModelRevision = 2
const lemonNote = 'Начинка: сливочный крем-чиз, 200 г на одну прослойку Ø18 см. Обтяжка: крем-чиз на масле, расход оценён по контрольному торту Ø20 см на 2,5 кг без клубники. При изменении размера крем пересчитывается по площади. Для Пан де Жен пока используется состав из задания пекарю.'
const honeyNote = 'Эталон медового коржа Ø18 см: 60 г сырого теста, около 30 г готового коржа после обрезки, один слой. Цветная глазурь (40 г в ТТК) не включена до уточнения её состава.'

function calibrateHoney(item) {
  const originalMass = item.ingredients.reduce((sum,[,grams]) => sum+grams,0)
  return {...item,yield:30,batch:{pans:1,layers:1,diameter:18,fill:60,trimIncluded:true},
    ingredients:item.ingredients.map(([name,grams]) => [name,grams/originalMass*60])}
}

const lemonCream = {name:'Сливочный крем-чиз',role:'pastry',yield:880,ingredients:[['Творожный сыр Креметте',534],['Сливки 33%',178],['Сахарная пудра',178]]}

const butterCream = {name:'Крем-чиз на масле',role:'pastry',kind:'coat',yield:2000,ingredients:[['Масло сливочное',380],['Сахарная пудра',380],['Творожный сыр Креметте',1240]]}

const recipes = [
  {
    id:'lemon',modelRevision:lemonModelRevision,finish:{coat:lemonCoatingRate,berry:155,extra:0}, name:'Лимонно-маковый', source:'Tillypad · 547759_.jpg и 547758_.jpg · задание пекарю 547764_.xlsx',
    note:lemonNote,
    components:[
      {name:'Пан де Жен маковый',role:'baker',kind:'core',share:450,yield:1040,batch:{pans:3,layers:2,diameter:18,fill:400},ingredients:[['Мука миндальная',240],['Сахарная пудра',240],['Белок куриный',48],['Яйцо куриное',473],['Масло сливочное',150],['Мука пшеничная ВС',55],['Мак',35],['Разрыхлитель',6]],
       method:'Подготовить и взвесить ингредиенты. Яйца перемешать и нагреть до 40–45 °C на водяной бане. Смешать миндальную муку и пудру, добавить белок и перемешать венчиком на низкой скорости до получения марципана. Ввести яйца в 5–6 приёмов на средней скорости. Взбивать на средне-высокой скорости 15–20 минут до лёгкого рисующего следа. Масло растопить и охладить до 70 °C. Муку с разрыхлителем просеять в яично-миндальную смесь и перемешать спатулой. Часть теста смешать с маслом и вернуть в общую массу. Разлить тесто по формам согласно расчёту. В исходной карте для Ø18 см указан режим 170–175 °C около 30 минут. Для другого размера проверить готовность и уточнить время. Остудить, упаковать в плёнку и убрать в холодильник.'},
      {name:'Сахарный сироп',role:'pastry',kind:'core',share:50,yield:50,ingredients:[['Сахар песок белый',26],['Вода',24]]},
      {name:'Лимонный сок',role:'pastry',kind:'core',share:2,yield:2,ingredients:[['Лимон',10]]},
      {name:'Лимонный курд',role:'pastry',kind:'core',share:120,yield:120,ingredients:[['Сахар песок белый',35.9],['Лимон',35.9],['Желток куриный',44.8],['Масло сливочное',26.9]]},
      {...lemonCream,kind:'core',share:400,portion:lemonFillingPortion},
      {...butterCream,portion:lemonCoatingPortion},
    ],
  },
  {
    id:'honey',finish:{coat:410,berry:150,extra:0},name:'Медовый',source:'Tillypad · 547767_.jpg и 547766_.jpg',
    note:honeyNote,
    components:[
      calibrateHoney({name:'Медовые коржи',role:'baker',kind:'core',share:406.6,ingredients:[['Мука пшеничная ВС',242.6],['Масло сливочное',60.3],['Яйцо куриное',90.5],['Сахар песок белый',60.3],['Мёд натуральный',30.2],['Сода',6],['Лимон',6]]}),
      {name:'Брусничное варенье',role:'pastry',kind:'core',share:60,yield:60,ingredients:[['Брусника мороженая',45],['Сахар песок белый',15]]},
      {name:'Сметанный крем с патисьером',role:'pastry',kind:'core',share:810,yield:810,ingredients:[['Сметана 30%',283.7],['Творожный сыр Креметте',70.9],['Желток куриный',66.5],['Молоко цельное',277.1],['Сахар песок белый',55.4],['Крахмал кукурузный',22.2],['Сахарная пудра',70.9]]},
      butterCream,
    ],
  },
]

function applyClarifiedRecipes(recipe) {
  if (recipe.id === 'honey') {
    const old = recipe.components.find(item => item.name === 'Медовые коржи' && !item.batch && item.yield === 406.6)
    if (!old) return recipe
    return {...recipe,note:recipe.note?.startsWith('В расчёт основы входят медовые коржи') ? honeyNote : recipe.note,
      components:recipe.components.map(item => item === old ? calibrateHoney(old) : item)}
  }
  if (recipe.id === 'lemon' && recipe.modelRevision !== lemonModelRevision) {
    const filling = recipe.components.find(item => item.name === lemonCream.name && item.kind === 'core')
    const coating = recipe.components.find(item => item.kind === 'coat')
    const oldSplit = !filling?.portion && filling?.share === 880 && coating?.name === butterCream.name
    const sharedCream = filling?.portion?.perGap && coating?.name === lemonCream.name
    if (!oldSplit && !sharedCream) return recipe
    const finish = {...recipes[0].finish,...recipe.finish}
    if ([625,480000/1022].includes(finish.coat)) finish.coat = lemonCoatingRate
    const oldNote = ['Для бисквита используется рецептура из задания пекарю','Для Ø18 см: три коржа'].some(prefix => recipe.note?.startsWith(prefix))
    return {...recipe,modelRevision:lemonModelRevision,finish,note:oldNote ? lemonNote : recipe.note,
      components:recipe.components.map(item => {
        if (item === filling && oldSplit) return {...filling,share:400,portion:lemonFillingPortion}
        if (item === coating) return {...(oldSplit ? coating : butterCream),portion:lemonCoatingPortion}
        return item
      })}
  }
  return recipe
}

const initialHistory = [
  {id:'case-lemon',recipe:'lemon',name:'Торт с сердцем',date:'2026-11-08',measured:6.3,basis:'gross',board:.6,coat:2,berry:.5,photo:'assets/lemon.webp',
   shape:'Нижний ярус Ø30 см, 3 коржа. Верхний ярус выпекали в Ø18 см и обрезали до сердца 16 см. Подложка Ø42 см, коробка 42 × 42 × 45 см.',
   notes:'Несезонную ягоду выкладывали красной стороной вверх. 6,3 кг — вес обоих ярусов с подложкой. Вес без подложки по уточнению — около 5,8 кг, по разнице 6,3 и 0,6 кг — 5,7 кг.',
   source:'547763_.rtf · фото 547762_.jpg'},
  {id:'case-honey',recipe:'honey',name:'Медовый на юбилей',measured:8.3,basis:'gross',board:.65,coat:2,berry:.75,photo:'assets/honey.webp',
   shape:'Овальная подложка 60 × 40 см. 12 коржей 50 × 30 см.',
   notes:'750 г ягод не хватило для плотной выкладки. Оформили с более редкими промежутками. 2 кг крема использовали на обтяжку и рюши.',
   source:'547765_.rtf · фото 547768_.jpg'},
]
