// Shared catalogue: the tray and authoritative cast validation use one vocabulary.
export const SPELLS = Object.freeze([
  {id:'skeleton',label:'Skeleton',cost:15,target:'point',icon:'☠'},
  {id:'squad',label:'Skeleton Squad',cost:38,target:'point',icon:'☠'},
  {id:'golem',label:'Stone Golem',cost:45,target:'point',icon:'◆'},
  {id:'raise',label:'Raise Earth',cost:12,target:'point',icon:'▲'},
  {id:'lower',label:'Lower Earth',cost:12,target:'point',icon:'▼'},
  {id:'sunder',label:'Sunder',cost:14,target:'line',icon:'ϟ'},
  {id:'wall',label:'Stone Wall',cost:14,target:'line',icon:'▰'},
  {id:'grove',label:'Grove',cost:10,target:'point',icon:'♣'},
  {id:'ring',label:'Tree Ring',cost:12,target:'point',icon:'◉'},
  {id:'starfall',label:'Starfall',cost:25,target:'point',icon:'☄'},
  {id:'crystal',label:'Crystal Bloom',cost:20,target:'point',icon:'♦'},
  {id:'heal',label:'Healing Rain',cost:18,target:'point',icon:'✚'},
  {id:'lightning',label:'Lightning',cost:22,target:'point',icon:'ϟ'},
  {id:'frost',label:'Frost Nova',cost:20,target:'point',icon:'❄'},
].map(s=>Object.freeze({...s,cooldown:45})));
export const SPELL_COST = Object.freeze(Object.fromEntries(SPELLS.map(s=>[s.id,s.cost])));
export const WEAPONS = Object.freeze([
  {id:'axe',label:'Axe',slot:1,cooldown:27}, {id:'pick',label:'Pick',slot:2,cooldown:29},
  {id:'hammer',label:'War Hammer',slot:3,cooldown:40}, {id:'crossbow',label:'Siegebird',slot:4,cooldown:42},
  {id:'bow',label:'Emberwing',slot:5,cooldown:33}, {id:'limb',label:'Held Limb',slot:6,cooldown:32},
  {id:'wyrmspout',label:'Wyrmspout',slot:7,cooldown:6}, {id:'flask',label:'Emberdew',slot:8,cooldown:60},
].map(Object.freeze));
