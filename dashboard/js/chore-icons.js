// Chore icons from Lucide (lucide.dev, ISC licence). Only these are bundled. Each has words that
// suggest it while typing a chore name ("piano" -> piano, "bins" -> trash).
import {
  AlarmClock, Apple, Baby, Backpack, Bath, Bed, Bike, Bone, Book, BookOpen, Brush, BrushCleaning, Bus,
  Calculator, Car, Carrot, Cat, ChefHat, Coffee, Cookie, CookingPot, Dog, Droplets, Drum, Dumbbell, Egg,
  Fish, Flame, Flower2, Footprints, Gamepad2, Gift, Glasses, Guitar, Hammer, HandHeart, Heart, House, Key,
  Lamp, Languages, Laptop, Leaf, Lock, Mail, Milk, Moon, Music, Notebook, Package, Paintbrush, Palette,
  PawPrint, Pencil, Phone, Piano, Pill, Recycle, Refrigerator, Sandwich, School, Scissors, Shirt,
  ShoppingBasket, ShowerHead, Shovel, Smile, Sofa, Soup, Sparkles, SprayCan, Sprout, Star, Sun, Toilet,
  Trash2, Trees, Trophy, Tv, Utensils, Volleyball, Wallet, WashingMachine, Wrench, Bubbles,
} from 'lucide';

// [name, icon, search words]
var LIST = [
  ['bed', Bed, 'bed make sleep bedroom'], ['shirt', Shirt, 'clothes dressed laundry put away uniform'],
  ['brush', Brush, 'teeth brush hair'], ['shower', ShowerHead, 'shower wash'], ['bath', Bath, 'bath bathe'],
  ['toilet', Toilet, 'toilet loo bathroom clean'], ['backpack', Backpack, 'backpack school bag pack'],
  ['school', School, 'school'], ['bus', Bus, 'bus school run'], ['car', Car, 'car drive drop pick lift wash'],
  ['book-open', BookOpen, 'read reading book'], ['book', Book, 'book library'], ['notebook', Notebook, 'homework notebook'],
  ['pencil', Pencil, 'homework write writing spelling'], ['calculator', Calculator, 'maths math sums'],
  ['languages', Languages, 'french spanish language'], ['laptop', Laptop, 'laptop computer coding'],
  ['piano', Piano, 'piano keyboard'], ['guitar', Guitar, 'guitar'], ['drum', Drum, 'drum drums'],
  ['music', Music, 'music practice sing instrument violin'], ['palette', Palette, 'art draw drawing paint'],
  ['paintbrush', Paintbrush, 'paint painting decorate'], ['utensils', Utensils, 'table set lay dinner cutlery plates'],
  ['cooking-pot', CookingPot, 'cook cooking dinner'], ['chef-hat', ChefHat, 'cook bake baking'], ['soup', Soup, 'lunch soup meal'],
  ['sandwich', Sandwich, 'lunch lunchbox sandwich packed'], ['apple', Apple, 'fruit snack healthy'],
  ['carrot', Carrot, 'vegetables veg'], ['egg', Egg, 'breakfast eggs'], ['milk', Milk, 'milk'],
  ['coffee', Coffee, 'coffee tea'], ['cookie', Cookie, 'treat cookie biscuit'], ['refrigerator', Refrigerator, 'fridge food'],
  ['droplets', Droplets, 'dishes wash up washing up water'], ['bubbles', Bubbles, 'dishwasher bubbles wash'],
  ['spray-can', SprayCan, 'clean wipe spray surfaces counters'], ['sparkles', Sparkles, 'tidy clean sparkle'],
  ['brush-cleaning', BrushCleaning, 'sweep hoover vacuum floor dust'], ['washing-machine', WashingMachine, 'laundry washing machine'],
  ['trash', Trash2, 'bins bin rubbish trash garbage'], ['recycle', Recycle, 'recycling recycle'],
  ['sofa', Sofa, 'lounge living room tidy'], ['lamp', Lamp, 'lights lamp'], ['house', House, 'house home'],
  ['lock', Lock, 'lock up doors'], ['key', Key, 'keys'], ['mail', Mail, 'post letters mail'], ['package', Package, 'parcel package'],
  ['shopping-basket', ShoppingBasket, 'shopping groceries'], ['wallet', Wallet, 'money pocket bills'],
  ['gift', Gift, 'gift present birthday'], ['phone', Phone, 'call phone ring'],
  ['dog', Dog, 'dog walk feed'], ['cat', Cat, 'cat feed litter'], ['fish', Fish, 'fish tank feed'],
  ['paw-print', PawPrint, 'pet pets feed'], ['bone', Bone, 'dog treat bone'],
  ['sprout', Sprout, 'water plants seeds'], ['flower', Flower2, 'flowers garden plants'], ['leaf', Leaf, 'leaves garden rake'],
  ['trees', Trees, 'garden outside'], ['shovel', Shovel, 'garden dig weed weeding'],
  ['hammer', Hammer, 'fix diy build'], ['wrench', Wrench, 'fix repair'], ['scissors', Scissors, 'cut craft'],
  ['dumbbell', Dumbbell, 'exercise gym workout'], ['bike', Bike, 'bike cycle ride'], ['footprints', Footprints, 'walk run steps'],
  ['volleyball', Volleyball, 'sport football netball ball practice training'], ['trophy', Trophy, 'match game win'],
  ['gamepad', Gamepad2, 'games screen time console'], ['tv', Tv, 'tv television screen'],
  ['pill', Pill, 'medicine vitamins tablets'], ['glasses', Glasses, 'glasses'], ['baby', Baby, 'baby'],
  ['heart', Heart, 'kind love help'], ['hand-heart', HandHeart, 'help helping kind'], ['smile', Smile, 'happy'],
  ['star', Star, 'star special'], ['sun', Sun, 'morning'], ['moon', Moon, 'night bedtime evening'],
  ['alarm-clock', AlarmClock, 'wake up alarm early'], ['flame', Flame, 'fire heating'],
];

function svg(node, size) {
  return '<svg class="i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    node.map(function (el) {
      return '<' + el[0] + Object.keys(el[1]).map(function (k) { return ' ' + k + '="' + el[1][k] + '"'; }).join('') + '/>';
    }).join('') + '</svg>';
}

var BY = {};
LIST.forEach(function (x) { BY[x[0]] = x; });

// Exposed on window so the classic view scripts can use it.
window.ChoreIcons = {
  names: LIST.map(function (x) { return x[0]; }),
  svg: function (name, size) { return svg((BY[name] || BY.star)[1], size || 30); },
  // Best icons for a chore name, best first.
  suggest: function (title) {
    var words = String(title || '').toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 2; });
    if (!words.length) return [];
    return LIST.map(function (x) {
      var score = 0;
      words.forEach(function (w) {
        x[2].split(' ').forEach(function (k) { if (k === w) score += 3; else if (k.indexOf(w) === 0 || w.indexOf(k) === 0) score += 1; });
      });
      return [x[0], score];
    }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; }).map(function (x) { return x[0]; });
  },
};
