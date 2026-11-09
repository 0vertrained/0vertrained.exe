// Meal Planning Engine v2
// Recipe library + constraint solver for θVERTRAINED.
//
// Key changes in v2:
//   - 5 meal slots (breakfast, lunch, snack1, dinner, snack2) to support
//     3,000–4,000 kcal/day athletes without unrealistic per-meal sizes
//   - Calorically appropriate recipes: mains 550–900 kcal, snacks 280–420 kcal
//   - 90+ recipes total for genuine regeneration variety
//   - Solver adds randomness on regenerate so all slots change, not just snack

export const DIETARY_TAGS = [
  { key: "gluten-free", label: "Gluten-free" },
  { key: "dairy-free",  label: "Dairy-free"  },
  { key: "nut-free",    label: "Nut-free"    },
  { key: "egg-free",    label: "Egg-free"    },
  { key: "soy-free",    label: "Soy-free"    },
];

// Helper — builds a recipe object and derives total macros from ingredients
function recipe(id, name, slot, tags, ingredients, steps, prepMins, cookMins) {
  const macros = ingredients.reduce(
    (a, i) => ({ calories: a.calories+i.cal, protein: a.protein+i.pro, carbs: a.carbs+i.carb, fats: a.fats+i.fat }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );
  // Round totals
  macros.calories = Math.round(macros.calories);
  macros.protein  = Math.round(macros.protein);
  macros.carbs    = Math.round(macros.carbs);
  macros.fats     = Math.round(macros.fats);
  const ings = ingredients.map(i => ({
    name: i.name, qty: i.qty,
    calories: Math.round(i.cal), protein: Math.round(i.pro),
    carbs: Math.round(i.carb), fats: Math.round(i.fat),
  }));
  return { id, name, slot, tags, macros, ingredients: ings, steps, prepMins, cookMins };
}

// Shorthand for ingredients: { name, qty, cal, pro, carb, fat }
const i = (name, qty, cal, pro, carb, fat) => ({ name, qty, cal, pro, carb, fat });

// RECIPES
// Target ranges by slot (scaled to 3,600 kcal/day, 5 meals):
//   breakfast:  600–900 kcal, 40–60g protein
//   lunch:      700–950 kcal, 50–70g protein
//   snack1/2:  280–420 kcal, 20–35g protein
//   dinner:    700–950 kcal, 50–70g protein
export const RECIPES = [

  // ── BREAKFAST (23 recipes) ─────────────────────────────────────────────────
  recipe("b01","Egg White Omelette + Oats","breakfast",["gluten-free","nut-free","soy-free"],[
    i("Egg whites",       "10 large",  170,35,2,0),
    i("Whole eggs",       "2",         143,13,1,10),
    i("Spinach",          "1 cup",       7, 1,1,0),
    i("Bell pepper",      "½",          15, 1,3,0),
    i("Cheddar (light)",  "1 oz",       50, 7,1,2),
    i("Rolled oats",      "1 cup dry",  300,10,54,6),
    i("Honey",            "1 tbsp",      64, 0,17,0),
    i("Banana",           "½",          45, 1,12,0),
  ],[
    "Cook oats with water per package; stir in honey. Slice banana on top.",
    "Whisk egg whites and eggs, season well.",
    "Heat a non-stick pan over medium, cook omelette 3–4 min, add spinach, pepper, and cheese, fold.",
    "Plate omelette alongside the oats.",
  ], 5, 10),

  recipe("b02","Greek Yogurt Power Bowl","breakfast",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Non-fat Greek yogurt","2 cups",     260,44,20,1),
    i("Whey protein",        "1 scoop",    130,25,5,2),
    i("Granola (GF)",        "½ cup",      200, 4,36,4),
    i("Blueberries",         "¾ cup",       63, 1,16,0),
    i("Honey",               "1 tbsp",      64, 0,17,0),
    i("Chia seeds",          "1 tbsp",      58, 2,5,3),
  ],[
    "Stir whey protein into Greek yogurt until smooth.",
    "Layer yogurt, granola, and blueberries in a bowl.",
    "Drizzle honey over top and sprinkle chia seeds.",
  ], 5, 0),

  recipe("b03","Overnight Oats + Protein","breakfast",["egg-free","soy-free"],[
    i("Rolled oats",      "1 cup dry",  300,10,54,6),
    i("Almond milk",      "1 cup",       40, 1, 2,3),
    i("Greek yogurt",     "¾ cup",       98,17, 7,0),
    i("Whey protein",     "1 scoop",    130,25, 5,2),
    i("Banana",           "1 medium",    89, 1,23,0),
    i("Chia seeds",       "1 tbsp",      58, 2, 5,3),
    i("Peanut butter",    "1 tbsp",      94, 4, 3,8),
  ],[
    "Combine oats, chia, protein powder, and yogurt in a jar.",
    "Pour in almond milk and stir; mix in peanut butter.",
    "Refrigerate overnight (at least 6 hrs).",
    "Top with sliced banana in the morning. Add more milk if too thick.",
  ], 5, 0),

  recipe("b04","Protein Pancakes + Eggs","breakfast",["soy-free"],[
    i("Whey protein",     "1 scoop",    130,25, 5,2),
    i("Oat flour",        "¾ cup",      225, 8,40,5),
    i("Eggs",             "3",          216,18, 2,14),
    i("Greek yogurt",     "¼ cup",       33, 6, 2,0),
    i("Almond milk",      "¼ cup",       10, 0, 0,1),
    i("Baking powder",    "½ tsp",        1, 0, 0,0),
    i("Eggs (side)",      "2",           143,13, 1,10),
    i("Mixed berries",    "½ cup",        40, 1,10,0),
  ],[
    "Mix protein, oat flour, baking powder. Whisk 3 eggs, yogurt, and almond milk; combine.",
    "Cook pancakes on a greased non-stick pan over medium-low, 2–3 min per side. Makes 4.",
    "Scramble or fry the 2 side eggs separately.",
    "Plate pancakes alongside eggs; top with berries.",
  ], 5, 14),

  recipe("b05","Steak & Eggs + Sweet Potato","breakfast",["gluten-free","dairy-free","nut-free","soy-free"],[
    i("Sirloin steak",    "6 oz",       270,42, 0,12),
    i("Eggs",             "3 large",    216,18, 2,14),
    i("Sweet potato",     "1 medium",   112, 2,26, 0),
    i("Olive oil",        "1 tsp",       40, 0, 0, 5),
    i("Garlic powder",    "½ tsp",        3, 0, 1, 0),
  ],[
    "Microwave sweet potato 4–5 min until tender, or roast at 400°F for 25 min.",
    "Season steak with garlic powder, salt, and pepper.",
    "Heat cast iron over high heat. Sear steak 2–3 min per side. Rest 4 min and slice.",
    "In same pan on medium, cook eggs to your preference.",
    "Plate steak, eggs, and sweet potato together.",
  ], 5, 15),

  recipe("b06","Salmon Scramble + Rice","breakfast",["gluten-free","dairy-free","nut-free","soy-free"],[
    i("Smoked salmon",    "4 oz",       132,21, 0, 5),
    i("Eggs",             "4 large",    286,24, 2,19),
    i("White rice",       "1 cup cooked",206,4,45, 0),
    i("Spinach",          "1 cup",        7, 1, 1, 0),
    i("Olive oil",        "1 tsp",       40, 0, 0, 5),
    i("Capers",           "1 tbsp",       4, 0, 1, 0),
    i("Lemon juice",      "1 tbsp",       4, 0, 1, 0),
  ],[
    "Cook rice if not pre-made. Keep warm.",
    "Heat olive oil over medium. Wilt spinach 1 min.",
    "Add beaten eggs and scramble gently until just set.",
    "Flake smoked salmon through the eggs; add capers, lemon juice, season.",
    "Serve scramble over rice.",
  ], 5, 12),

  recipe("b07","Cottage Cheese Breakfast Bowl","breakfast",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Cottage cheese (2%)", "2 cups",   412,56,12, 8),
    i("Whey protein",        "1 scoop",  130,25, 5, 2),
    i("Pineapple chunks",    "¾ cup",     62, 1,16, 0),
    i("Banana",              "1",          89, 1,23, 0),
    i("Granola (GF)",        "¼ cup",     100, 2,18, 2),
    i("Cinnamon",            "¼ tsp",       2, 0, 0, 0),
  ],[
    "Stir whey protein into cottage cheese until smooth.",
    "Top with pineapple, banana, and granola.",
    "Dust with cinnamon and serve immediately.",
  ], 3, 0),

  recipe("b08","Turkey Bacon & Egg Muffins + Oats","breakfast",["gluten-free","nut-free","soy-free"],[
    i("Turkey bacon",     "4 strips",   120,12, 2, 6),
    i("Eggs",             "4 large",    286,24, 2,19),
    i("Cheddar",          "1 oz",        50, 7, 1, 2),
    i("Bell pepper diced","½ cup",        15, 1, 3, 0),
    i("Rolled oats",      "1 cup dry",  300,10,54, 6),
    i("Honey",            "1 tbsp",      64, 0,17, 0),
    i("Blueberries",      "½ cup",       42, 1,11, 0),
  ],[
    "Preheat oven to 375°F. Cook turkey bacon until crisp, crumble.",
    "Whisk eggs with cheese, pepper, bacon. Pour into greased muffin tin. Bake 15–18 min.",
    "Meanwhile, cook oats with water. Top with honey and blueberries.",
    "Serve 3 egg muffins alongside the oats.",
  ], 5, 20),

  recipe("b09","Tuna Rice Bowl","breakfast",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Canned tuna (water)","2 cans",   200,46, 0, 2),
    i("White rice",         "1½ cups cooked",308,6,68,0),
    i("Avocado",            "½",         115, 1, 6,10),
    i("Lime juice",         "1 tbsp",     4, 0, 1, 0),
    i("Hot sauce",          "1 tsp",      2, 0, 0, 0),
    i("Sesame seeds",       "1 tsp",     17, 1, 1, 2),
  ],[
    "Drain and season tuna with lime juice and hot sauce.",
    "Bowl: rice base, tuna on top, sliced avocado alongside.",
    "Sprinkle sesame seeds over the top.",
  ], 5, 0),

  recipe("b10","High-Protein Smoothie Bowl","breakfast",["gluten-free","egg-free","soy-free"],[
    i("Frozen banana",      "1.5",       135, 2,35, 0),
    i("Whey protein",       "1.5 scoops",195,37, 7, 3),
    i("Almond milk",        "½ cup",      20, 1, 1, 2),
    i("Peanut butter",      "2 tbsp",    188, 8, 6,16),
    i("Granola",            "½ cup",     200, 4,36, 4),
    i("Strawberries",       "½ cup",      23, 0, 6, 0),
    i("Greek yogurt",       "½ cup",      65,11, 5, 0),
  ],[
    "Blend frozen banana, protein powder, almond milk, and Greek yogurt until thick. Add minimal liquid.",
    "Pour into a bowl — it should be scoopable, not drinkable.",
    "Top with granola, strawberries, and dollops of peanut butter.",
  ], 5, 0),

  recipe("b11","Ground Beef Hash","breakfast",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Lean ground beef 93%","6 oz",    240,34, 0,12),
    i("Sweet potato",        "1.5 medium",168,3,39, 0),
    i("Bell pepper",         "1",          31, 1, 7, 0),
    i("Onion",               "½",          32, 1, 8, 0),
    i("Olive oil",           "1 tbsp",    119, 0, 0,14),
    i("Garlic",              "2 cloves",    9, 0, 2, 0),
    i("Paprika + cumin",     "½ tsp ea",    5, 0, 1, 0),
  ],[
    "Dice sweet potato into ½-inch cubes. Par-cook in the microwave 3 min.",
    "Heat olive oil in a large skillet. Brown sweet potato 3–4 min until crispy.",
    "Add diced onion and pepper; cook 3 min. Add garlic, paprika, and cumin.",
    "Push vegetables aside. Brown ground beef, breaking up, 4–5 min.",
    "Combine everything, season well with salt and pepper.",
  ], 8, 15),

  recipe("b12","Protein Waffle Plate","breakfast",["soy-free"],[
    i("Protein waffle mix or oat flour","1 cup",300,10,54,4),
    i("Whey protein",       "1 scoop",   130,25, 5, 2),
    i("Eggs",               "2",         143,13, 1,10),
    i("Almond milk",        "½ cup",      20, 1, 1, 2),
    i("Turkey bacon",       "3 strips",   90, 9, 1, 4),
    i("Maple syrup",        "1 tbsp",      52, 0,13, 0),
    i("Strawberries",       "½ cup",       23, 0, 6, 0),
  ],[
    "Mix waffle batter: flour, protein, eggs, almond milk. Let rest 2 min.",
    "Cook waffles in a preheated, greased waffle iron until golden. Makes 2 large.",
    "Cook turkey bacon in a pan until crisp.",
    "Plate waffles topped with strawberries and a drizzle of maple syrup, bacon alongside.",
  ], 5, 12),

  recipe("b13","Chicken Sausage & Egg Rice Bowl","breakfast",["gluten-free","dairy-free","nut-free","soy-free"],[
    i("Chicken breakfast sausage","5 oz",200,24, 4,10),
    i("Eggs",                     "3 large",216,18, 2,14),
    i("White rice",              "1 cup cooked",206,4,45, 0),
    i("Spinach",                 "1 cup",    7, 1, 1, 0),
    i("Avocado",                 "¼",       58, 1, 3, 5),
    i("Hot sauce",               "to taste", 2, 0, 0, 0),
  ],[
    "Brown crumbled chicken sausage in a skillet over medium heat, 4–5 min.",
    "Push aside; scramble eggs in the same pan until just set.",
    "Wilt spinach in the residual heat.",
    "Bowl: rice base, sausage, eggs, spinach, sliced avocado. Finish with hot sauce.",
  ], 5, 10),

  recipe("b14","Blueberry Protein French Toast","breakfast",["nut-free","soy-free"],[
    i("Whole-grain bread","3 slices",240,12,42, 3),
    i("Eggs",             "3",         216,18, 2,14),
    i("Whey protein",     "1 scoop",   130,25, 5, 2),
    i("Skim milk",        "¼ cup",      22, 2, 3, 0),
    i("Blueberries",      "½ cup",      42, 1,11, 0),
    i("Maple syrup",      "1 tbsp",     52, 0,13, 0),
    i("Cinnamon",         "¼ tsp",       2, 0, 0, 0),
  ],[
    "Whisk eggs, milk, protein powder, and cinnamon into a custard.",
    "Soak bread slices 20 sec per side.",
    "Cook on a greased non-stick pan over medium 2–3 min per side until golden.",
    "Top with blueberries and a drizzle of maple syrup.",
  ], 5, 10),

  recipe("b15","Savory Oatmeal with Eggs & Turkey","breakfast",["gluten-free","nut-free","soy-free"],[
    i("Rolled oats",      "1 cup dry", 300,10,54, 6),
    i("Eggs",             "2",         143,13, 1,10),
    i("Turkey sausage",   "3 oz",      130,16, 2, 7),
    i("Cheddar",          "1 oz",       50, 7, 1, 2),
    i("Spinach",          "1 cup",       7, 1, 1, 0),
  ],[
    "Cook oats with water and a pinch of salt until creamy.",
    "Brown crumbled turkey sausage; stir spinach in to wilt.",
    "Fry or poach the eggs to your preference.",
    "Top savory oats with sausage, spinach, cheddar, and the eggs.",
  ], 5, 12),

  recipe("b16","Tropical Green Protein Smoothie","breakfast",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Pea protein",      "1.5 scoops",180,36, 3, 3),
    i("Mango",            "¾ cup",      75, 1,19, 0),
    i("Frozen banana",    "1",          89, 1,23, 0),
    i("Coconut water",    "1 cup",      45, 0, 9, 0),
    i("Spinach",          "1 cup",       7, 1, 1, 0),
    i("Rolled oats",      "½ cup dry", 150, 5,27, 3),
    i("Hemp seeds",       "2 tbsp",     80, 5, 1, 6),
    i("Chia seeds",       "1 tbsp",     58, 2, 5, 3),
  ],[
    "Add all ingredients to a blender with ice.",
    "Blend on high until completely smooth, 45–60 sec.",
    "Pour into a tall glass; add water to thin if needed.",
  ], 5, 0),

  recipe("b17","Turkey Veggie Scramble + Toast","breakfast",["dairy-free","nut-free","soy-free"],[
    i("Eggs",             "4 large",   286,24, 2,19),
    i("Ground turkey 93%","4 oz",      120,19, 0, 5),
    i("Bell pepper + onion","1 cup",    46, 2,10, 0),
    i("Whole-grain toast","2 slices",  160, 8,28, 2),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
  ],[
    "Brown ground turkey with the diced pepper and onion in olive oil.",
    "Pour in beaten eggs; scramble gently until just set.",
    "Season well with salt and pepper.",
    "Serve alongside toast.",
  ], 5, 12),

  recipe("b18","Peanut Butter Banana Protein Oats","breakfast",["gluten-free","egg-free","soy-free"],[
    i("Rolled oats",      "1 cup dry", 300,10,54, 6),
    i("Whey protein",     "1 scoop",   130,25, 5, 2),
    i("Peanut butter",    "1 tbsp",     94, 4, 3, 8),
    i("Banana",           "1 medium",   89, 1,23, 0),
    i("Chia seeds",       "1 tbsp",     58, 2, 5, 3),
    i("Almond milk",      "1 cup",      40, 1, 2, 3),
  ],[
    "Cook oats with almond milk and a splash of water until creamy.",
    "Off heat, stir in protein powder until dissolved.",
    "Swirl in peanut butter; top with sliced banana and chia seeds.",
  ], 5, 6),

  recipe("b19","Ham & Cheese Egg Cups + Potatoes","breakfast",["gluten-free","nut-free","soy-free"],[
    i("Eggs",             "4 large",   286,24, 2,19),
    i("Diced ham",        "3 oz",      120,18, 2, 4),
    i("Cheddar",          "1 oz",       50, 7, 1, 2),
    i("Yukon gold potatoes","1 cup",   116, 3,26, 0),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
  ],[
    "Preheat oven to 375°F. Whisk eggs with ham and cheese; pour into a greased muffin tin.",
    "Bake 15–18 min until set. Makes 6 cups.",
    "Toss cubed potatoes with olive oil and salt; roast alongside until crisp.",
    "Serve egg cups with the roasted potatoes.",
  ], 5, 20),

  recipe("b20","Smoked Salmon Avocado Rice Bowl","breakfast",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Smoked salmon",    "6 oz",      198,32, 0, 7),
    i("White rice",       "1 cup cooked",206,4,45, 0),
    i("Avocado",          "½",         115, 1, 6,10),
    i("Cucumber",         "½",          16, 1, 4, 0),
    i("Hemp seeds",       "2 tbsp",     80, 5, 1, 6),
    i("Everything seasoning","½ tsp",    5, 0, 1, 0),
    i("Lemon juice",      "1 tbsp",      4, 0, 1, 0),
  ],[
    "Spoon warm rice into a bowl.",
    "Top with flaked smoked salmon, sliced avocado, and cucumber.",
    "Sprinkle hemp seeds and everything seasoning; finish with lemon.",
  ], 5, 0),

  recipe("b21","Protein Bagel Breakfast Sandwich","breakfast",["nut-free","soy-free"],[
    i("Whole-grain bagel","1",         250,10,48, 2),
    i("Eggs",             "2",         143,13, 1,10),
    i("Egg whites",       "3",          51,11, 1, 0),
    i("Turkey bacon",     "3 strips",   90, 9, 1, 4),
    i("Cheddar",          "1 oz",       50, 7, 1, 2),
  ],[
    "Toast the bagel. Cook turkey bacon until crisp.",
    "Scramble the eggs and egg whites together until just set.",
    "Layer egg, bacon, and cheese on the bagel.",
  ], 4, 10),

  recipe("b22","Berry Almond Protein Yogurt Bowl","breakfast",["gluten-free","egg-free","soy-free"],[
    i("Non-fat Greek yogurt","2 cups", 260,44,20, 1),
    i("Whey protein",     "½ scoop",    65,12, 3, 1),
    i("Mixed berries",    "1 cup",      80, 2,20, 0),
    i("Almonds",          "1 oz",      164, 6, 6,14),
    i("Honey",            "1 tbsp",     64, 0,17, 0),
  ],[
    "Stir protein powder into the Greek yogurt until smooth.",
    "Top with mixed berries and sliced almonds.",
    "Drizzle honey over the top.",
  ], 3, 0),

  recipe("b23","Sweet Potato & Chicken Breakfast Hash","breakfast",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chicken breast",   "6 oz",      186,39, 0, 4),
    i("Sweet potato",     "1.5 medium",168, 3,39, 0),
    i("Bell pepper",      "1",          31, 1, 7, 0),
    i("Onion",            "½",          32, 1, 8, 0),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
    i("Avocado",          "¼",          58, 1, 3, 5),
    i("Paprika + cumin",  "½ tsp ea",    5, 0, 1, 0),
  ],[
    "Dice sweet potato small; par-cook in the microwave 3 min.",
    "Crisp the sweet potato in olive oil, then add pepper and onion.",
    "Add diced chicken and spices; cook until chicken reaches 165°F.",
    "Top with sliced avocado.",
  ], 8, 15),

  // ── LUNCH (23 recipes) ────────────────────────────────────────────────────
  recipe("l01","Chicken Rice Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Chicken breast",     "8 oz",      248,52, 0, 5),
    i("White rice",         "1.5 cups cooked",309,6,68,0),
    i("Broccoli",           "1.5 cups",   82, 5,15, 0),
    i("Olive oil",          "1 tbsp",    119, 0, 0,14),
    i("Tamari (GF)",        "1 tbsp",     11, 2, 1, 0),
    i("Garlic",             "2 cloves",    9, 0, 2, 0),
    i("Sesame oil",         "½ tsp",      20, 0, 0, 2),
  ],[
    "Season chicken with salt and pepper. Heat olive oil over medium-high.",
    "Cook chicken 5–6 min per side until 165°F. Rest and slice.",
    "Stir-fry broccoli with garlic 3–4 min. Add tamari and sesame oil.",
    "Serve chicken and broccoli over rice.",
  ], 5, 15),

  recipe("l02","Ground Turkey Power Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Ground turkey 93%","8 oz",        240,37, 0,10),
    i("Brown rice",       "1.5 cups cooked",324,8,68,3),
    i("Black beans",      "¾ cup canned",165,11,30,1),
    i("Avocado",          "½",           115, 1, 6,10),
    i("Salsa",            "3 tbsp",       15, 1, 3, 0),
    i("Cumin + chili pwdr","1 tsp ea",    10, 0, 2, 0),
    i("Olive oil",        "1 tsp",        40, 0, 0, 5),
  ],[
    "Brown turkey in olive oil over medium-high; season with cumin and chili powder.",
    "Warm black beans in a small pan with a pinch of cumin.",
    "Bowl: rice base, turkey, beans, sliced avocado.",
    "Top with salsa.",
  ], 5, 12),

  recipe("l03","Salmon Quinoa Bowl","lunch",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Salmon fillet",    "7 oz",        364,49, 0,17),
    i("Quinoa",           "1 cup cooked",222, 8,39, 4),
    i("Cucumber",         "½",            16, 1, 4, 0),
    i("Cherry tomatoes",  "¾ cup",        40, 2, 9, 0),
    i("Olive oil",        "1.5 tbsp",    179, 0, 0,21),
    i("Lemon juice",      "1 tbsp",        4, 0, 1, 0),
    i("Feta (dairy OK)",  "1 oz",         75, 4, 1, 6),
    i("Fresh parsley",    "2 tbsp",        3, 0, 0, 0),
  ],[
    "Season salmon with lemon zest, salt, and pepper.",
    "Pan-sear in 1 tbsp olive oil 3–4 min per side until cooked through. Flake.",
    "Toss quinoa with remaining olive oil, lemon juice, and parsley.",
    "Build bowl: quinoa, salmon, cucumber, tomatoes, and feta.",
  ], 5, 10),

  recipe("l04","Tuna Pasta Bowl","lunch",["dairy-free","nut-free","egg-free","soy-free"],[
    i("Whole-wheat pasta",  "3 oz dry",  300,11,63, 2),
    i("Canned tuna",        "2 cans",    200,46, 0, 2),
    i("Olive oil",          "1.5 tbsp",  179, 0, 0,21),
    i("Cherry tomatoes",    "½ cup",      27, 1, 6, 0),
    i("Garlic",             "3 cloves",   13, 1, 3, 0),
    i("Capers",             "1 tbsp",      4, 0, 1, 0),
    i("Spinach",            "1 cup",       7, 1, 1, 0),
    i("Lemon juice",        "1 tbsp",      4, 0, 1, 0),
  ],[
    "Cook pasta al dente. Reserve ½ cup pasta water before draining.",
    "Sauté garlic in olive oil 1 min. Add halved tomatoes and cook 2 min.",
    "Add drained tuna, capers, and spinach. Toss 1 min.",
    "Add pasta and a splash of pasta water. Toss to coat, squeeze lemon over.",
  ], 5, 12),

  recipe("l05","Lean Beef Stir-Fry + Rice","lunch",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Lean ground beef 93%","7 oz",    280,39, 0,14),
    i("White rice",           "1.5 cups cooked",309,6,68,0),
    i("Mixed stir-fry veg",   "2 cups", 80, 4,16, 0),
    i("Tamari (GF)",          "1.5 tbsp",17,3, 2, 0),
    i("Sesame oil",           "1 tsp",   40, 0, 0, 5),
    i("Garlic",               "3 cloves",13, 1, 3, 0),
    i("Ginger",               "¼ tsp",    1, 0, 0, 0),
  ],[
    "Brown beef in a hot wok, breaking up. Drain fat.",
    "Add garlic, ginger, and vegetables. Stir-fry 3–4 min on high.",
    "Add tamari and sesame oil. Toss 1 min.",
    "Serve over rice.",
  ], 5, 12),

  recipe("l06","Shrimp Burrito Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Shrimp",             "8 oz",      224,48, 3, 2),
    i("White rice",         "1.5 cups cooked",309,6,68,0),
    i("Black beans",        "¾ cup",     165,11,30, 1),
    i("Corn",               "¼ cup",      35, 1, 8, 1),
    i("Pico de gallo",      "¼ cup",      15, 1, 3, 0),
    i("Avocado",            "¼",          58, 1, 3, 5),
    i("Lime + cumin",       "1 tbsp lime", 4, 0, 1, 0),
  ],[
    "Season shrimp with cumin, chili powder, salt, and lime juice.",
    "Cook in a hot pan 1–2 min per side until pink.",
    "Warm beans and corn together.",
    "Bowl: rice, beans and corn, shrimp, avocado, pico.",
  ], 5, 8),

  recipe("l07","Pork Tenderloin & Sweet Potato","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Pork tenderloin",    "7 oz",      238,42, 0, 7),
    i("Sweet potato",       "1.5 medium",168, 3,39, 0),
    i("Green beans",        "1.5 cups",   53, 3,12, 0),
    i("Olive oil",          "1.5 tbsp",  179, 0, 0,21),
    i("Dijon mustard",      "1 tbsp",     15, 1, 1, 1),
    i("Rosemary",           "1 tsp",       3, 0, 1, 0),
    i("Garlic",             "2 cloves",    9, 0, 2, 0),
  ],[
    "Rub pork with Dijon, rosemary, garlic, salt, and pepper.",
    "Cube sweet potato; toss with 1 tbsp olive oil. Roast at 425°F 20 min.",
    "Sear pork in remaining oil 2 min per side; finish in oven 12–15 min to 145°F. Rest 5 min.",
    "Steam green beans 4 min. Plate everything together.",
  ], 8, 25),

  recipe("l08","Chicken Caesar Wrap","lunch",["nut-free","egg-free","soy-free"],[
    i("Chicken breast",   "7 oz",        217,46, 0, 5),
    i("Whole-wheat wraps","2 large",     240, 8,44, 4),
    i("Romaine lettuce",  "2 cups",       16, 1, 3, 0),
    i("Parmesan",         "¼ cup",       107,10, 1, 7),
    i("Caesar dressing",  "2 tbsp",       80, 1, 1, 8),
    i("Greek yogurt",     "¼ cup",        33, 6, 2, 0),
    i("Lemon juice",      "1 tsp",         1, 0, 0, 0),
  ],[
    "Season and grill or pan-fry chicken 5–6 min per side. Slice thin.",
    "Mix Caesar dressing with Greek yogurt to lighten it.",
    "Toss romaine with dressing and Parmesan.",
    "Divide salad and chicken between wraps. Roll tightly and slice in half.",
  ], 5, 12),

  recipe("l09","Bison Rice Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Ground bison",       "7 oz",      240,35, 0,12),
    i("White rice",         "1.5 cups cooked",309,6,68,0),
    i("Asparagus",          "10 spears",  40, 4, 7, 0),
    i("Olive oil",          "1 tbsp",    119, 0, 0,14),
    i("Garlic",             "2 cloves",    9, 0, 2, 0),
    i("Worcestershire (GF)","1 tsp",       4, 0, 1, 0),
    i("Cherry tomatoes",    "½ cup",      27, 1, 6, 0),
  ],[
    "Brown bison in olive oil with garlic and Worcestershire. Season well.",
    "Trim asparagus; pan-roast 3–4 min in same pan.",
    "Halve cherry tomatoes and toss with asparagus.",
    "Bowl: rice base, bison, asparagus, tomatoes.",
  ], 5, 12),

  recipe("l10","Tuna Sweet Potato Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Canned tuna",        "2 cans",    200,46, 0, 2),
    i("Sweet potato",       "2 medium",  224, 4,52, 0),
    i("Avocado",            "½",         115, 1, 6,10),
    i("Spinach",            "2 cups",     14, 2, 2, 0),
    i("Olive oil",          "1 tbsp",    119, 0, 0,14),
    i("Lemon + hot sauce",  "1 tbsp lemon",4, 0, 1, 0),
    i("Hemp seeds",         "2 tbsp",     80, 5, 1, 6),
  ],[
    "Bake or microwave sweet potatoes until tender. Halve.",
    "Fluff sweet potato flesh with a fork; season with olive oil, salt, pepper.",
    "Top each potato half with tuna, avocado, and spinach.",
    "Drizzle lemon juice and hot sauce. Sprinkle hemp seeds.",
  ], 5, 20),

  recipe("l11","Cod Tacos","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Cod fillet",         "8 oz",      187,41, 0, 2),
    i("Corn tortillas",     "4 (6-inch)",200, 4,44, 4),
    i("Purple cabbage",     "1 cup",      28, 1, 7, 0),
    i("Avocado",            "½",         115, 1, 6,10),
    i("Mango",              "½ cup",      50, 0,12, 0),
    i("Lime juice",         "1 tbsp",      4, 0, 1, 0),
    i("Olive oil",          "1 tbsp",    119, 0, 0,14),
    i("Cumin + chili",      "½ tsp ea",    5, 0, 1, 0),
  ],[
    "Season cod with cumin, chili, salt. Sear in olive oil 3 min per side.",
    "Slice cabbage thin. Dice mango and avocado.",
    "Warm tortillas in a dry pan.",
    "Fill tortillas with flaked cod, cabbage, mango-avocado mix. Squeeze lime over.",
  ], 8, 8),

  recipe("l12","Chicken Egg Fried Rice","lunch",["gluten-free","dairy-free","nut-free"],[
    i("Chicken breast",     "6 oz",      186,39, 0, 4),
    i("White rice (day-old)","2 cups cooked",412,8,90,0),
    i("Eggs",               "3",         216,18, 2,14),
    i("Peas + carrots",     "½ cup",      60, 3,12, 1),
    i("Tamari (GF)",        "2 tbsp",     22, 4, 2, 0),
    i("Sesame oil",         "1 tsp",      40, 0, 0, 5),
    i("Green onion",        "2 stalks",    6, 0, 1, 0),
    i("Garlic",             "2 cloves",    9, 0, 2, 0),
  ],[
    "Dice and stir-fry chicken in a hot wok until cooked. Set aside.",
    "In same wok, scramble eggs until just set. Set aside.",
    "Add garlic, peas, and carrots; stir-fry 2 min.",
    "Add rice; toss on high heat 2–3 min. Return chicken and eggs.",
    "Add tamari and sesame oil. Toss everything together. Top with green onion.",
  ], 5, 12),

  recipe("l13","Teriyaki Chicken Rice Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Chicken breast",   "8 oz",      248,52, 0, 5),
    i("White rice",       "1.5 cups cooked",309,6,68,0),
    i("Broccoli",         "1.5 cups",   82, 5,15, 0),
    i("Tamari (GF)",      "1 tbsp",     11, 2, 1, 0),
    i("Honey",            "1 tbsp",     64, 0,17, 0),
    i("Sesame oil",       "1 tsp",      40, 0, 0, 5),
    i("Garlic + ginger",  "2 cloves + ¼ tsp",12,0,3,0),
  ],[
    "Whisk tamari, honey, garlic, and ginger into a quick teriyaki glaze.",
    "Sear diced chicken in sesame oil until cooked through; add glaze and reduce 1 min.",
    "Steam broccoli 3–4 min.",
    "Serve chicken and broccoli over rice with glaze spooned over.",
  ], 5, 15),

  recipe("l14","Turkey Quinoa Stuffed Peppers","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Ground turkey 93%","7 oz",      210,32, 0, 9),
    i("Quinoa",           "1 cup cooked",222,8,39, 4),
    i("Bell peppers",     "2",          62, 2,14, 0),
    i("Crushed tomatoes", "½ cup",      20, 1, 5, 0),
    i("Black beans",      "½ cup",     110, 7,20, 1),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
  ],[
    "Preheat oven to 375°F. Halve and seed the peppers.",
    "Brown turkey in olive oil; stir in quinoa, tomatoes, beans, and spices.",
    "Stuff peppers with the mixture; bake 20 min until tender.",
  ], 8, 25),

  recipe("l15","Mediterranean Chicken Couscous Bowl","lunch",["nut-free","egg-free","soy-free"],[
    i("Chicken breast",   "7 oz",      217,46, 0, 5),
    i("Couscous",         "1 cup cooked",176,6,36,0),
    i("Cucumber",         "½",          16, 1, 4, 0),
    i("Cherry tomatoes",  "¾ cup",      40, 2, 9, 0),
    i("Feta",             "1 oz",       75, 4, 1, 6),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
    i("Lemon + parsley",  "1 tbsp lemon", 4, 0, 1, 0),
  ],[
    "Season and grill chicken 5–6 min per side; slice.",
    "Fluff cooked couscous with olive oil and lemon.",
    "Bowl: couscous, chicken, cucumber, tomatoes, crumbled feta, parsley.",
  ], 5, 12),

  recipe("l16","Beef & Bean Burrito Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Lean ground beef 93%","7 oz",   280,39, 0,14),
    i("Brown rice",       "1 cup cooked",216,5,45, 2),
    i("Pinto beans",      "¾ cup",     165,11,30, 1),
    i("Corn",             "¼ cup",      35, 1, 8, 1),
    i("Salsa",            "3 tbsp",     15, 1, 3, 0),
    i("Avocado",          "¼",          58, 1, 3, 5),
  ],[
    "Brown beef with cumin and chili powder; season well.",
    "Warm beans and corn together.",
    "Bowl: rice, beef, beans and corn, salsa, sliced avocado.",
  ], 5, 12),

  recipe("l17","Grilled Chicken Greek Salad + Pita","lunch",["nut-free","egg-free","soy-free"],[
    i("Chicken breast",   "8 oz",      248,52, 0, 5),
    i("Whole-wheat pita", "1",         170, 6,35, 2),
    i("Romaine + cucumber + tomato","2 cups",40,2,9,0),
    i("Feta",             "1 oz",       75, 4, 1, 6),
    i("Kalamata olives",  "10",         50, 0, 3, 5),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
    i("Red wine vinegar", "1 tbsp",      3, 0, 1, 0),
  ],[
    "Grill chicken 5–6 min per side; slice.",
    "Toss greens, tomato, cucumber, olives, and feta with oil and vinegar.",
    "Serve chicken over the salad with warm pita alongside.",
  ], 8, 12),

  recipe("l18","Salmon Poke Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Sushi-grade salmon","6 oz",     312,42, 0,15),
    i("White rice",       "1.5 cups cooked",309,6,68,0),
    i("Edamame (shelled)","¼ cup",      47, 5, 4, 2),
    i("Cucumber",         "½",          16, 1, 4, 0),
    i("Avocado",          "¼",          58, 1, 3, 5),
    i("Tamari (GF)",      "1 tbsp",     11, 2, 1, 0),
    i("Sesame seeds",     "1 tsp",      17, 1, 1, 2),
  ],[
    "Dice salmon and toss with tamari and sesame seeds.",
    "Bowl: rice base, salmon, edamame, cucumber, avocado.",
    "Chill 5 min before serving for best texture.",
  ], 10, 0),

  recipe("l19","Chicken Pesto Pasta","lunch",["egg-free","soy-free"],[
    i("Chicken breast",   "7 oz",      217,46, 0, 5),
    i("Whole-wheat pasta","3 oz dry",  300,11,63, 2),
    i("Basil pesto",      "2 tbsp",    160, 2, 2,16),
    i("Cherry tomatoes",  "½ cup",      27, 1, 6, 0),
    i("Parmesan",         "2 tbsp",     43, 4, 0, 3),
  ],[
    "Cook pasta al dente; reserve a little pasta water.",
    "Grill and slice chicken.",
    "Toss pasta with pesto, chicken, halved tomatoes, and a splash of pasta water.",
    "Finish with grated Parmesan.",
  ], 5, 14),

  recipe("l20","Shrimp Fried Rice","lunch",["gluten-free","dairy-free","nut-free"],[
    i("Shrimp",           "7 oz",      196,42, 3, 2),
    i("White rice (day-old)","1.5 cups cooked",309,6,68,0),
    i("Eggs",             "2",         143,13, 1,10),
    i("Peas + carrots",   "½ cup",      60, 3,12, 1),
    i("Tamari (GF)",      "1.5 tbsp",   17, 3, 2, 0),
    i("Sesame oil",       "1 tsp",      40, 0, 0, 5),
  ],[
    "Scramble eggs in a hot wok; set aside.",
    "Sear shrimp 1–2 min per side; set aside.",
    "Stir-fry peas and carrots, then add rice and toss on high heat 2–3 min.",
    "Return eggs and shrimp; add tamari and sesame oil. Toss to combine.",
  ], 5, 12),

  recipe("l21","Roast Beef & Cheddar Sandwich","lunch",["nut-free","egg-free","soy-free"],[
    i("Roast beef (lean deli)","7 oz", 245,42, 0, 8),
    i("Whole-grain bread","2 slices",  160, 8,28, 2),
    i("Cheddar",          "1 oz",       50, 7, 1, 2),
    i("Avocado",          "½",         115, 1, 6,10),
    i("Cabbage slaw",     "1 cup",      40, 1, 7, 2),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
  ],[
    "Mash avocado onto the bread.",
    "Layer roast beef and cheddar; add slaw dressed with olive oil.",
    "Close the sandwich and slice.",
  ], 5, 0),

  recipe("l22","Tofu Veggie Stir-Fry + Rice","lunch",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Firm tofu",        "8 oz",      220,24, 6,12),
    i("White rice",       "1.5 cups cooked",309,6,68,0),
    i("Mixed stir-fry veg","2 cups",    80, 4,16, 0),
    i("Edamame (shelled)","½ cup",      94, 9, 7, 4),
    i("Tamari (GF)",      "1.5 tbsp",   17, 3, 2, 0),
    i("Sesame oil",       "1 tsp",      40, 0, 0, 5),
    i("Garlic + ginger",  "2 cloves + ¼ tsp",12,0,3,0),
  ],[
    "Press and cube tofu; sear in sesame oil until golden on all sides.",
    "Add garlic, ginger, vegetables, and edamame; stir-fry 3–4 min on high.",
    "Add tamari and toss. Serve over rice.",
  ], 8, 12),

  recipe("l23","Chicken Fajita Bowl","lunch",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chicken breast",   "8 oz",      248,52, 0, 5),
    i("White rice",       "1.5 cups cooked",309,6,68,0),
    i("Bell peppers + onions","1.5 cups",62,2,14,0),
    i("Black beans",      "½ cup",     110, 7,20, 1),
    i("Avocado",          "¼",          58, 1, 3, 5),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
    i("Fajita spices + lime","1 tsp",    6, 0, 1, 0),
  ],[
    "Toss sliced chicken with fajita spices; sear in olive oil until cooked.",
    "Char peppers and onions in the same pan.",
    "Bowl: rice, black beans, chicken, fajita veg, avocado. Squeeze lime over.",
  ], 5, 15),

  // ── DINNER (23 recipes) ───────────────────────────────────────────────────
  recipe("d01","Baked Salmon + Asparagus + Rice","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Salmon fillet",    "7 oz",       364,49, 0,17),
    i("Asparagus",        "1 bunch",     53, 5, 9, 0),
    i("Brown rice",       "1 cup cooked",216,5,45, 2),
    i("Olive oil",        "1.5 tbsp",   179, 0, 0,21),
    i("Garlic",           "3 cloves",    13, 1, 3, 0),
    i("Lemon",            "1",           22, 1, 8, 0),
    i("Fresh dill",       "2 sprigs",     2, 0, 0, 0),
  ],[
    "Preheat oven to 400°F. Toss asparagus with ½ tbsp olive oil and season.",
    "Rub salmon with remaining olive oil, garlic, salt, pepper, and dill.",
    "Arrange salmon and asparagus on a sheet pan. Lay lemon slices over salmon.",
    "Roast 14–16 min until salmon flakes easily.",
    "Serve over rice with roasting juices drizzled over.",
  ], 5, 16),

  recipe("d02","Chicken Thigh + Sweet Potato + Greens","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chicken thighs (skinless)","8 oz",272,38, 0,13),
    i("Sweet potato",    "1.5 medium",  168, 3,39, 0),
    i("Kale",            "2 cups",       70, 6,14, 1),
    i("Olive oil",       "1.5 tbsp",    179, 0, 0,21),
    i("Garlic",          "3 cloves",     13, 1, 3, 0),
    i("Smoked paprika",  "1 tsp",         6, 0, 1, 0),
    i("Apple cider vinegar","1 tsp",      2, 0, 0, 0),
  ],[
    "Preheat oven to 425°F. Cube sweet potato; toss with 1 tbsp oil and roast 20 min.",
    "Rub chicken with paprika, garlic, salt, and pepper. Sear 3 min per side.",
    "Transfer chicken to oven; roast 15 min until 165°F.",
    "Sauté kale with remaining oil and a splash of vinegar until wilted, 3 min.",
    "Plate chicken, sweet potato, and kale together.",
  ], 8, 30),

  recipe("d03","Lean Beef Meatballs + Pasta","dinner",["dairy-free","nut-free","egg-free","soy-free"],[
    i("Lean ground beef 93%","7 oz",    280,39, 0,14),
    i("Whole-wheat pasta",   "3 oz dry",300,11,63, 2),
    i("Marinara sauce",      "1 cup",   140, 4,22, 4),
    i("Garlic",              "3 cloves", 13, 1, 3, 0),
    i("Italian seasoning",   "1 tsp",    3, 0, 1, 0),
    i("Onion powder",        "½ tsp",    4, 0, 1, 0),
    i("Fresh basil",         "a few leaves",2,0, 0, 0),
  ],[
    "Mix beef with Italian seasoning, onion powder, garlic, salt, and pepper. Form 8 meatballs.",
    "Bake at 400°F 15 min or pan-fry until cooked through.",
    "Cook pasta al dente. Warm marinara with garlic. Combine meatballs in sauce.",
    "Serve meatballs and sauce over pasta, topped with fresh basil.",
  ], 10, 20),

  recipe("d04","Turkey Chili + Rice","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Ground turkey 93%", "8 oz",      240,37, 0,10),
    i("Kidney beans",      "¾ cup",     165, 8,30, 0),
    i("Black beans",       "½ cup",     110, 7,20, 1),
    i("Crushed tomatoes",  "1 cup",      41, 2, 9, 0),
    i("White rice",        "1 cup cooked",206,4,45,0),
    i("Bell pepper + onion","1 cup diced",40, 1, 9, 0),
    i("Chili pwdr + cumin","1 tsp ea",   10, 0, 2, 0),
    i("Garlic",            "3 cloves",   13, 1, 3, 0),
  ],[
    "Brown turkey with onion, bell pepper, and garlic over medium-high heat.",
    "Add spices and stir 1 min. Add tomatoes and both beans.",
    "Simmer 20 min, stirring occasionally. Adjust seasoning.",
    "Serve over rice. Optional: avocado or hot sauce on top.",
  ], 8, 28),

  recipe("d05","Pork Tenderloin + Quinoa + Green Beans","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Pork tenderloin",  "8 oz",       272,48, 0, 8),
    i("Quinoa",           "1 cup cooked",222,8,39, 4),
    i("Green beans",      "2 cups",      70, 4,16, 0),
    i("Olive oil",        "1.5 tbsp",   179, 0, 0,21),
    i("Dijon mustard",    "1 tbsp",      15, 1, 1, 1),
    i("Garlic",           "2 cloves",     9, 0, 2, 0),
    i("Rosemary",         "1 tsp",        3, 0, 1, 0),
  ],[
    "Rub pork with Dijon, rosemary, garlic, salt, and pepper.",
    "Sear in 1 tbsp oil 2 min per side. Roast at 425°F 12–15 min to 145°F. Rest 5 min.",
    "Blanch green beans 4 min in salted boiling water. Toss with remaining oil.",
    "Slice pork and serve over quinoa with green beans alongside.",
  ], 8, 20),

  recipe("d06","Shrimp + Zucchini Noodles + Quinoa","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Shrimp",           "8 oz",       224,48, 3, 2),
    i("Zucchini",         "3 large",     99, 7,18, 0),
    i("Quinoa",           "¾ cup cooked",166,6,29, 3),
    i("Cherry tomatoes",  "¾ cup",       40, 2, 9, 0),
    i("Olive oil",        "1.5 tbsp",   179, 0, 0,21),
    i("Garlic",           "3 cloves",    13, 1, 3, 0),
    i("Lemon",            "½",           11, 0, 4, 0),
    i("Basil",            "a few leaves", 2, 0, 0, 0),
  ],[
    "Cook quinoa and set aside.",
    "Spiralize zucchini. Sauté garlic in olive oil 30 sec.",
    "Add shrimp and tomatoes; cook 2 min per side until pink.",
    "Add zucchini noodles; toss 1–2 min. Squeeze lemon, add basil.",
    "Plate over quinoa.",
  ], 10, 12),

  recipe("d07","Bison Burger + Roasted Veg","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Ground bison",     "8 oz",       275,40, 0,13),
    i("Sweet potato",     "1.5 medium", 168, 3,39, 0),
    i("Zucchini",         "1",           33, 2, 6, 0),
    i("Bell pepper",      "1",           31, 1, 7, 0),
    i("Red onion",        "½",           32, 1, 8, 0),
    i("Olive oil",        "1.5 tbsp",   179, 0, 0,21),
    i("Garlic powder",    "½ tsp",        3, 0, 1, 0),
  ],[
    "Preheat oven to 425°F. Chop veg; toss with 1 tbsp olive oil, season, roast 25 min.",
    "Mix bison with garlic powder, salt, and pepper. Form 2 patties.",
    "Grill or pan-fry bison 3–4 min per side (cooks faster than beef).",
    "Plate bison patties alongside roasted vegetables.",
  ], 8, 28),

  recipe("d08","Cod + Brown Rice + Asparagus","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Cod fillet",       "8 oz",       187,41, 0, 2),
    i("Brown rice",       "1 cup cooked",216,5,45, 2),
    i("Asparagus",        "12 spears",   40, 4, 7, 0),
    i("Olive oil",        "1.5 tbsp",   179, 0, 0,21),
    i("Capers",           "1 tbsp",       4, 0, 1, 0),
    i("Lemon",            "½",           11, 0, 4, 0),
    i("Garlic",           "2 cloves",     9, 0, 2, 0),
  ],[
    "Season cod with lemon zest, salt, and pepper.",
    "Sear cod in 1 tbsp olive oil 2 min; flip; finish in 400°F oven 8 min.",
    "Toss asparagus with remaining oil and garlic; roast alongside 10 min.",
    "Drizzle cod with lemon juice and scatter capers. Serve over rice.",
  ], 5, 14),

  recipe("d09","Chicken Stir-Fry + Noodles","dinner",["dairy-free","nut-free","egg-free"],[
    i("Chicken breast",   "8 oz",       248,52, 0, 5),
    i("Rice noodles",     "3 oz dry",   315, 6,72, 1),
    i("Bok choy",         "2 cups",      20, 3, 3, 0),
    i("Snap peas",        "1 cup",       41, 3, 7, 0),
    i("Tamari (GF)",      "2 tbsp",      22, 4, 2, 0),
    i("Sesame oil",       "1 tsp",       40, 0, 0, 5),
    i("Garlic + ginger",  "2 cloves + ¼ tsp",12,0, 3, 0),
    i("Sriracha",         "1 tsp",        5, 0, 1, 0),
  ],[
    "Slice chicken thin. Soak noodles per package directions.",
    "Stir-fry chicken in a hot wok until cooked. Set aside.",
    "Add garlic, ginger, bok choy, and snap peas. Stir-fry 3 min.",
    "Add noodles, chicken, tamari, sesame oil, and sriracha. Toss 2 min.",
  ], 8, 12),

  recipe("d10","Lamb Loin Chops + Roasted Potatoes","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Lamb loin chops",  "6 oz",       294,32, 0,18),
    i("Baby potatoes",    "1.5 cups",   194, 5,44, 0),
    i("Green beans",      "1.5 cups",    53, 3,12, 0),
    i("Olive oil",        "1.5 tbsp",   179, 0, 0,21),
    i("Rosemary + garlic","1 tsp + 3 cloves",16,0, 4, 0),
    i("Dijon",            "1 tsp",        5, 0, 0, 0),
  ],[
    "Halve potatoes; toss with 1 tbsp oil, rosemary, salt. Roast at 425°F 25 min.",
    "Rub lamb with Dijon, garlic, salt, and pepper.",
    "Pan-sear lamb in remaining oil 3 min per side for medium-rare.",
    "Steam green beans 4 min. Plate lamb, potatoes, and green beans together.",
  ], 8, 28),

  recipe("d11","Beef & Broccoli + Rice","dinner",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Flank steak",      "7 oz",       280,42, 0,12),
    i("White rice",       "1.5 cups cooked",309,6,68,0),
    i("Broccoli",         "2 cups",     110, 7,20, 1),
    i("Tamari (GF)",      "2 tbsp",      22, 4, 2, 0),
    i("Sesame oil",       "1 tsp",       40, 0, 0, 5),
    i("Cornstarch",       "1 tsp",       10, 0, 2, 0),
    i("Garlic + ginger",  "3 cloves + ¼ tsp",14,0, 4, 0),
    i("Olive oil",        "1 tsp",       40, 0, 0, 5),
  ],[
    "Slice steak thin against the grain. Toss with cornstarch, tamari, and ginger.",
    "Stir-fry beef in very hot oiled wok 2 min until seared. Remove.",
    "Add garlic and broccoli. Stir-fry 3–4 min adding a splash of water.",
    "Return beef, add sesame oil and remaining tamari. Toss 1 min.",
    "Serve over rice.",
  ], 10, 12),

  recipe("d12","Whole Roasted Chicken Thighs + Potatoes","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chicken thighs (skin-on)","8 oz",336,38, 0,20),
    i("Yukon gold potatoes","1.5 cups",  170, 5,39, 0),
    i("Broccoli",           "1.5 cups",  82, 5,15, 0),
    i("Olive oil",          "1.5 tbsp", 179, 0, 0,21),
    i("Garlic",             "4 cloves",  18, 1, 4, 0),
    i("Paprika + oregano",  "½ tsp ea",   5, 0, 1, 0),
    i("Lemon",              "½",          11, 0, 4, 0),
  ],[
    "Preheat oven to 425°F. Halve potatoes and toss with 1 tbsp oil, salt, and pepper.",
    "Rub chicken with paprika, oregano, garlic, and remaining oil. Season skin generously.",
    "Place chicken skin-side up on a sheet pan; surround with potatoes.",
    "Roast 20 min; add broccoli and squeeze lemon over everything; roast 15 more min.",
  ], 8, 35),

  recipe("d13","Herb-Roasted Chicken + Quinoa + Broccoli","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chicken breast",   "8 oz",      248,52, 0, 5),
    i("Quinoa",           "1 cup cooked",222,8,39, 4),
    i("Broccoli",         "2 cups",    110, 7,20, 1),
    i("Olive oil",        "1.5 tbsp",  179, 0, 0,21),
    i("Garlic + herbs",   "3 cloves",   13, 1, 3, 0),
    i("Lemon",            "½",          11, 0, 4, 0),
  ],[
    "Preheat oven to 425°F. Rub chicken with 1 tbsp oil, garlic, and herbs.",
    "Roast chicken 18–20 min to 165°F; rest and slice.",
    "Toss broccoli with remaining oil; roast alongside 12 min.",
    "Serve chicken and broccoli over quinoa with a squeeze of lemon.",
  ], 8, 22),

  recipe("d14","Blackened Tilapia + Rice + Black Beans","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Tilapia",          "8 oz",      220,46, 0, 4),
    i("Brown rice",       "1 cup cooked",216,5,45, 2),
    i("Black beans",      "¾ cup",     165,11,30, 1),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
    i("Cajun spices",     "1 tsp",       5, 0, 1, 0),
    i("Lime + cilantro",  "1 tbsp lime", 4, 0, 1, 0),
  ],[
    "Coat tilapia in Cajun spices.",
    "Sear in olive oil over medium-high 3 min per side until blackened and flaky.",
    "Warm beans with a pinch of cumin.",
    "Serve tilapia over rice and beans; finish with lime and cilantro.",
  ], 5, 10),

  recipe("d15","Turkey Meatloaf + Mashed Potatoes + Green Beans","dinner",["gluten-free","nut-free","soy-free"],[
    i("Ground turkey 93%","8 oz",      240,37, 0,10),
    i("Rolled oats (binder)","¼ cup dry",75,3,14, 2),
    i("Egg",              "1",          72, 6, 1, 5),
    i("Mashed potatoes",  "1 cup",     160, 4,36, 1),
    i("Butter",           "1 tsp",      34, 0, 0, 4),
    i("Green beans",      "1.5 cups",   53, 3,12, 0),
    i("Ketchup glaze",    "2 tbsp",     20, 0, 5, 0),
  ],[
    "Preheat oven to 375°F. Mix turkey, oats, egg, and seasoning; form a loaf.",
    "Brush with ketchup glaze; bake 30–35 min to 165°F.",
    "Mash potatoes with butter and a splash of milk.",
    "Steam green beans 4 min. Plate everything together.",
  ], 10, 35),

  recipe("d16","Garlic Butter Shrimp + Rice + Cauliflower","dinner",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Shrimp",           "8 oz",      224,48, 3, 2),
    i("White rice",       "1.5 cups cooked",309,6,68,0),
    i("Cauliflower",      "1.5 cups",   60, 4,12, 1),
    i("Butter",           "1 tbsp",    102, 0, 0,12),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
    i("Garlic + parsley", "3 cloves",   13, 1, 3, 0),
  ],[
    "Steam and mash the cauliflower; season well.",
    "Sear shrimp in olive oil 1–2 min per side.",
    "Add butter and garlic; toss shrimp to coat. Finish with parsley.",
    "Serve shrimp over rice with cauliflower mash alongside.",
  ], 8, 12),

  recipe("d17","Sirloin Steak + Baked Potato + Asparagus","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Sirloin steak",    "7 oz",      315,49, 0,14),
    i("Baked potato",     "1 large",   160, 4,37, 0),
    i("Asparagus",        "1 bunch",    53, 5, 9, 0),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
    i("Garlic + pepper",  "2 cloves",    9, 0, 2, 0),
  ],[
    "Bake potato at 425°F ~45 min until tender.",
    "Season steak generously; sear in a hot cast-iron 3 min per side. Rest 5 min.",
    "Roast or pan-sear asparagus in olive oil with garlic 6–8 min.",
    "Slice steak and plate with potato and asparagus.",
  ], 5, 45),

  recipe("d18","Chicken Parmesan + Zucchini Noodles","dinner",["nut-free","soy-free"],[
    i("Chicken breast",   "8 oz",      248,52, 0, 5),
    i("Breadcrumbs",      "¼ cup",     110, 4,20, 1),
    i("Egg (dredge)",     "1",          72, 6, 1, 5),
    i("Marinara sauce",   "1 cup",     140, 4,22, 4),
    i("Mozzarella",       "1 oz",       85, 6, 1, 6),
    i("Zucchini noodles", "2 cups",     66, 5,12, 0),
    i("Olive oil",        "1 tbsp",    119, 0, 0,14),
  ],[
    "Dredge chicken in egg then breadcrumbs.",
    "Pan-fry in olive oil until golden; top with marinara and mozzarella.",
    "Bake at 400°F 12 min until cheese melts and chicken reaches 165°F.",
    "Sauté zucchini noodles 2 min; serve chicken over top.",
  ], 10, 25),

  recipe("d19","Miso-Glazed Salmon + Rice + Bok Choy","dinner",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Salmon fillet",    "7 oz",      364,49, 0,17),
    i("White rice",       "1 cup cooked",206,4,45, 0),
    i("Bok choy",         "2 cups",     20, 3, 3, 0),
    i("Miso paste",       "1 tbsp",     35, 2, 4, 1),
    i("Sesame oil",       "1 tsp",      40, 0, 0, 5),
    i("Green onion + ginger","2 stalks", 8, 0, 2, 0),
  ],[
    "Whisk miso with a little water and ginger into a glaze.",
    "Brush salmon and broil 8–10 min until caramelized and flaky.",
    "Sauté bok choy in sesame oil 3 min.",
    "Serve salmon over rice with bok choy; scatter green onion.",
  ], 5, 12),

  recipe("d20","Pork Chops + Brussels + Sweet Potato","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Pork loin chop",   "8 oz",      280,50, 0, 9),
    i("Brussels sprouts", "1.5 cups",   84, 6,17, 0),
    i("Sweet potato",     "1 medium",  112, 2,26, 0),
    i("Olive oil",        "1.5 tbsp",  179, 0, 0,21),
    i("Garlic + thyme",   "2 cloves",    9, 0, 2, 0),
    i("Balsamic vinegar", "1 tbsp",     14, 0, 3, 0),
  ],[
    "Preheat oven to 425°F. Halve Brussels and cube sweet potato; toss with 1 tbsp oil.",
    "Roast vegetables 25 min, tossing once.",
    "Sear pork chops in remaining oil 3–4 min per side to 145°F. Rest 5 min.",
    "Drizzle balsamic over the vegetables; plate with pork.",
  ], 8, 28),

  recipe("d21","Beef Taco Skillet + Rice","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Lean ground beef 93%","7 oz",   280,39, 0,14),
    i("White rice",       "1 cup cooked",206,4,45, 0),
    i("Black beans",      "¾ cup",     165,11,30, 1),
    i("Bell pepper + onion","1 cup",    46, 2,10, 0),
    i("Salsa",            "3 tbsp",     15, 1, 3, 0),
    i("Avocado",          "¼",          58, 1, 3, 5),
    i("Taco spices",      "1 tsp",       6, 0, 1, 0),
  ],[
    "Brown beef with pepper, onion, and taco spices.",
    "Stir in black beans and salsa; simmer 5 min.",
    "Serve over rice; top with sliced avocado.",
  ], 5, 15),

  recipe("d22","Baked Cod + Couscous + Roasted Veg","dinner",["dairy-free","nut-free","egg-free","soy-free"],[
    i("Cod fillet",       "8 oz",      187,41, 0, 2),
    i("Couscous",         "1 cup cooked",176,6,36, 0),
    i("Chickpeas",        "½ cup",     134, 7,22, 2),
    i("Zucchini + pepper + tomato","2 cups",80,4,16,0),
    i("Olive oil",        "1.5 tbsp",  179, 0, 0,21),
    i("Lemon + garlic + herbs","2 cloves",13,1,3,0),
  ],[
    "Preheat oven to 400°F. Toss vegetables and chickpeas with 1 tbsp oil; roast 20 min.",
    "Season cod with lemon, garlic, and herbs; bake alongside 12 min until flaky.",
    "Serve cod over couscous with the roasted vegetables.",
  ], 8, 22),

  recipe("d23","Chicken Thigh Coconut Curry + Rice","dinner",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chicken thighs (skinless)","8 oz",272,38,0,13),
    i("Basmati rice",     "1 cup cooked",206,4,45, 0),
    i("Light coconut milk","½ cup",    100, 1, 3,10),
    i("Spinach",          "2 cups",     14, 2, 2, 0),
    i("Onion + tomato",   "¾ cup",      40, 1, 9, 0),
    i("Curry spices + aromatics","1 tbsp",15,1,4,0),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
  ],[
    "Sauté onion, tomato, curry spices, garlic, and ginger in olive oil.",
    "Add diced chicken thighs; brown 5 min.",
    "Pour in coconut milk; simmer 12 min. Stir in spinach to wilt.",
    "Serve curry over basmati rice.",
  ], 8, 22),

  // ── SNACKS (23 recipes, ~280–420 kcal each) ────────────────────────────────
  recipe("s01","Protein Shake + Banana","snack",["gluten-free","egg-free","soy-free"],[
    i("Whey protein",     "1.5 scoops", 195,37, 7, 3),
    i("Banana",           "1 medium",    89, 1,23, 0),
    i("Almond milk",      "1 cup",       40, 1, 2, 3),
    i("Peanut butter",    "1 tbsp",      94, 4, 3, 8),
  ],[
    "Blend all ingredients with ice until smooth.",
    "Drink immediately.",
  ], 2, 0),

  recipe("s02","Greek Yogurt Parfait","snack",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Non-fat Greek yogurt","1.5 cups",195,33,15, 1),
    i("Granola (GF)",        "¼ cup",   100, 2,18, 2),
    i("Mixed berries",       "½ cup",    40, 1,10, 0),
    i("Honey",               "1 tbsp",   64, 0,17, 0),
    i("Whey protein",        "½ scoop",  65,12, 3, 1),
  ],[
    "Stir protein powder into yogurt.",
    "Layer yogurt, granola, and berries. Drizzle honey.",
  ], 3, 0),

  recipe("s03","Cottage Cheese & Pineapple","snack",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Cottage cheese (2%)", "1.5 cups",306,42, 9, 6),
    i("Pineapple chunks",    "¾ cup",    62, 1,16, 0),
    i("Cinnamon",            "¼ tsp",     2, 0, 0, 0),
    i("Hemp seeds",          "1 tbsp",   40, 3, 0, 3),
  ],[
    "Spoon cottage cheese into a bowl.",
    "Top with pineapple, hemp seeds, and cinnamon.",
  ], 2, 0),

  recipe("s04","Rice Cakes + Peanut Butter + Banana","snack",["gluten-free","dairy-free","egg-free","soy-free"],[
    i("Rice cakes",           "4",       140, 4,28, 0),
    i("Natural peanut butter","2.5 tbsp",236,10, 8,20),
    i("Banana",               "1",        89, 1,23, 0),
  ],[
    "Spread peanut butter over rice cakes.",
    "Top with sliced banana.",
  ], 2, 0),

  recipe("s05","Tuna + Rice Cakes + Avocado","snack",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Canned tuna",    "1 can (5 oz)",100,23, 0, 1),
    i("Rice cakes",     "4",           140, 4,28, 0),
    i("Avocado",        "½",           115, 1, 6,10),
    i("Lemon juice",    "1 tsp",         1, 0, 0, 0),
    i("Hot sauce",      "to taste",      2, 0, 0, 0),
  ],[
    "Mash avocado on rice cakes. Season with lemon and hot sauce.",
    "Top with drained, seasoned tuna.",
  ], 3, 0),

  recipe("s06","Hard-Boiled Eggs + Fruit + Nuts","snack",["gluten-free","dairy-free","soy-free"],[
    i("Hard-boiled eggs","4",           286,24, 2,19),
    i("Apple",           "1 medium",    95, 0,25, 0),
    i("Almonds",         "1 oz",        164, 6, 6,14),
  ],[
    "Peel pre-boiled eggs (batch cook earlier in the week).",
    "Eat eggs with sliced apple and a portion of almonds.",
  ], 2, 0),

  recipe("s07","PB Protein Smoothie","snack",["gluten-free","egg-free","soy-free"],[
    i("Whey protein",   "1 scoop",     130,25, 5, 2),
    i("Peanut butter",  "2 tbsp",      188, 8, 6,16),
    i("Banana",         "½",            45, 1,12, 0),
    i("Almond milk",    "1 cup",        40, 1, 2, 3),
    i("Oats",           "¼ cup dry",    75, 3,14, 2),
  ],[
    "Blend all ingredients with ice until smooth.",
    "Drink immediately or refrigerate up to 2 hours.",
  ], 3, 0),

  recipe("s08","Edamame + Beef Jerky","snack",["gluten-free","dairy-free","nut-free","egg-free"],[
    i("Frozen edamame (shelled)","1 cup",188,18,14, 8),
    i("Beef jerky (low-sodium)","2 oz",  186,26, 6, 5),
  ],[
    "Microwave edamame 3 min. Season with salt.",
    "Eat alongside beef jerky.",
  ], 2, 3),

  recipe("s09","Overnight Oats Snack Jar","snack",["egg-free","soy-free"],[
    i("Rolled oats",     "½ cup dry",  150, 5,27, 3),
    i("Greek yogurt",    "¾ cup",       98,17, 7, 0),
    i("Whey protein",    "½ scoop",     65,12, 3, 1),
    i("Almond milk",     "¼ cup",       10, 0, 1, 1),
    i("Blueberries",     "½ cup",       42, 1,11, 0),
  ],[
    "Mix oats, yogurt, protein, and almond milk in a jar.",
    "Refrigerate overnight. Top with blueberries to serve.",
  ], 3, 0),

  recipe("s10","Protein Rice Pudding","snack",["gluten-free","egg-free","soy-free"],[
    i("White rice (cooked)","1 cup",    206, 4,45, 0),
    i("Whey protein",       "1 scoop",  130,25, 5, 2),
    i("Almond milk",        "½ cup",     20, 1, 1, 2),
    i("Cinnamon",           "¼ tsp",      2, 0, 0, 0),
    i("Honey",              "½ tbsp",    32, 0, 8, 0),
  ],[
    "Warm rice with almond milk in a small pot over medium heat until creamy.",
    "Remove from heat; stir in protein powder until dissolved.",
    "Sweeten with honey and dust with cinnamon.",
  ], 2, 5),

  recipe("s11","Chicken + Sweet Potato Snack Box","snack",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Cooked chicken breast","3 oz",   93,20, 0, 2),
    i("Sweet potato",         "1 medium",112,2,26, 0),
    i("Guacamole",            "2 tbsp",  50, 1, 3, 5),
  ],[
    "Slice leftover cooked chicken. Microwave sweet potato 4–5 min.",
    "Portion into a container with guacamole.",
    "Eat warm or cold.",
  ], 3, 5),

  recipe("s12","Smoked Salmon + Crackers + Cream Cheese","snack",["nut-free","egg-free","soy-free"],[
    i("Smoked salmon",     "3 oz",      99,16, 0, 4),
    i("Whole-grain crackers","8",       160, 4,28, 4),
    i("Light cream cheese","2 tbsp",    70, 2, 2, 6),
    i("Capers",            "1 tsp",      2, 0, 0, 0),
    i("Cucumber slices",   "½ cup",      8, 0, 2, 0),
  ],[
    "Spread cream cheese on crackers.",
    "Top with smoked salmon, capers, and cucumber slices.",
  ], 3, 0),

  recipe("s13","Protein Energy Bites","snack",["egg-free","soy-free"],[
    i("Rolled oats",       "½ cup",    150, 5,27, 3),
    i("Peanut butter",     "2 tbsp",   188, 8, 6,16),
    i("Honey",             "1 tbsp",    64, 0,17, 0),
    i("Whey protein",      "½ scoop",   65,12, 3, 1),
    i("Chocolate chips (dark)","1 tbsp",70, 1, 9, 4),
  ],[
    "Mix all ingredients in a bowl until combined. Refrigerate 15 min.",
    "Roll into 8 balls. Store in the fridge. Makes a serving of 4.",
  ], 5, 0),

  recipe("s14","Turkey + Apple + Almond Butter","snack",["gluten-free","dairy-free","egg-free","soy-free"],[
    i("Sliced turkey breast","4 oz",   120,24, 0, 2),
    i("Apple",              "1 medium",  95, 0,25, 0),
    i("Almond butter",      "1.5 tbsp", 144, 5, 5,13),
  ],[
    "Slice apple and portion almond butter into a small cup.",
    "Eat turkey slices alongside apple and almond butter.",
  ], 2, 0),

  recipe("s15","Casein Chocolate Protein Pudding","snack",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Casein protein",   "1.5 scoops",180,36, 9, 3),
    i("Skim milk",        "½ cup",      42, 4, 6, 0),
    i("Cocoa powder",     "1 tbsp",     12, 1, 3, 1),
    i("Banana",           "½",          45, 1,12, 0),
    i("Honey",            "½ tbsp",     32, 0, 8, 0),
  ],[
    "Whisk casein, cocoa, and milk into a thick pudding.",
    "Sweeten with honey; fold in sliced banana.",
    "Chill 10 min to set before eating.",
  ], 3, 0),

  recipe("s16","Turkey & Cheese Roll-Ups + Grapes","snack",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Sliced turkey breast","5 oz",   150,30, 0, 3),
    i("Cheddar",          "1 oz",       50, 7, 1, 2),
    i("Grapes",           "1 cup",     104, 1,27, 0),
    i("Mustard",          "1 tsp",       5, 0, 1, 0),
  ],[
    "Spread mustard on turkey slices; roll around cheddar sticks.",
    "Serve with a side of grapes.",
  ], 3, 0),

  recipe("s17","Chocolate PB Protein Shake","snack",["gluten-free","egg-free","soy-free"],[
    i("Whey protein",     "1 scoop",   130,25, 5, 2),
    i("Peanut butter",    "1 tbsp",     94, 4, 3, 8),
    i("Banana",           "½",          45, 1,12, 0),
    i("Almond milk",      "1 cup",      40, 1, 2, 3),
    i("Cocoa powder",     "1 tbsp",     12, 1, 3, 1),
  ],[
    "Blend all ingredients with ice until smooth.",
    "Drink immediately.",
  ], 2, 0),

  recipe("s18","Cottage Cheese Toast + Tomato","snack",["nut-free","egg-free","soy-free"],[
    i("Whole-grain toast","2 slices",  160, 8,28, 2),
    i("Cottage cheese (2%)","¾ cup",   155,21, 5, 3),
    i("Tomato slices",    "½ cup",      15, 1, 3, 0),
    i("Everything seasoning","½ tsp",    5, 0, 1, 0),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
  ],[
    "Toast the bread.",
    "Spread cottage cheese; top with tomato slices.",
    "Drizzle olive oil and sprinkle everything seasoning.",
  ], 3, 3),

  recipe("s19","Roasted Chickpeas + String Cheese","snack",["gluten-free","nut-free","egg-free","soy-free"],[
    i("Roasted chickpeas","¾ cup",     202,11,34, 3),
    i("String cheese",    "2",         160,14, 2,12),
  ],[
    "Roast seasoned chickpeas at 400°F 25 min until crisp (or use pre-roasted).",
    "Eat alongside string cheese.",
  ], 2, 25),

  recipe("s20","Tuna Cucumber Boats","snack",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Canned tuna (water)","2 cans",  200,46, 0, 2),
    i("Cucumber",         "1 large",    30, 1, 7, 0),
    i("Avocado",          "¼",          58, 1, 3, 5),
    i("Olive oil",        "1 tsp",      40, 0, 0, 5),
    i("Lemon + dill",     "1 tsp lemon", 4, 0, 1, 0),
  ],[
    "Mash tuna with avocado, olive oil, lemon, and dill.",
    "Halve the cucumber lengthwise and scoop out the seeds.",
    "Fill the cucumber boats with tuna salad.",
  ], 5, 0),

  recipe("s21","Almond Butter Apple + Protein","snack",["gluten-free","egg-free","soy-free"],[
    i("Apple",            "1 medium",   95, 0,25, 0),
    i("Almond butter",    "1.5 tbsp",  144, 5, 5,13),
    i("Whey protein",     "1 scoop",   130,25, 5, 2),
  ],[
    "Shake whey protein with cold water.",
    "Slice apple and serve with almond butter for dipping.",
  ], 2, 0),

  recipe("s22","Protein Chia Pudding","snack",["gluten-free","dairy-free","nut-free","egg-free","soy-free"],[
    i("Chia seeds",       "2 tbsp",    116, 4,10, 6),
    i("Pea protein",      "1 scoop",   120,24, 2, 2),
    i("Light coconut milk","1 cup",    120, 1, 3,10),
    i("Blueberries",      "½ cup",      42, 1,11, 0),
    i("Honey",            "½ tbsp",     32, 0, 8, 0),
  ],[
    "Whisk chia, protein, and coconut milk; let sit 5 min then whisk again.",
    "Refrigerate at least 2 hrs (or overnight) until set.",
    "Top with blueberries and a drizzle of honey.",
  ], 3, 0),

  recipe("s23","Deli Turkey Wrap Pinwheels","snack",["nut-free","egg-free","soy-free"],[
    i("Whole-wheat tortilla","1 large",130, 4,22, 3),
    i("Sliced turkey breast","4 oz",   120,24, 0, 2),
    i("Light cream cheese","2 tbsp",    70, 2, 2, 6),
    i("Spinach",          "1 cup",       7, 1, 1, 0),
    i("Bell pepper strips","½ cup",      15, 1, 3, 0),
  ],[
    "Spread cream cheese over the tortilla.",
    "Layer turkey, spinach, and pepper strips.",
    "Roll tightly and slice into pinwheels.",
  ], 5, 0),
];

// Solver
// 5-meal slot structure
export const SLOTS = ["breakfast", "lunch", "snack1", "dinner", "snack2"];

// Map UI slots to recipe slots
const SLOT_TO_RECIPE = {
  breakfast: "breakfast",
  lunch:     "lunch",
  snack1:    "snack",
  dinner:    "dinner",
  snack2:    "snack",
};

// Proportional daily macro split across 5 meals
const SLOT_SPLIT = {
  breakfast: { calories: 0.24, protein: 0.24, carbs: 0.24, fats: 0.24 },
  lunch:     { calories: 0.28, protein: 0.28, carbs: 0.28, fats: 0.28 },
  snack1:    { calories: 0.10, protein: 0.10, carbs: 0.10, fats: 0.10 },
  dinner:    { calories: 0.28, protein: 0.28, carbs: 0.28, fats: 0.28 },
  snack2:    { calories: 0.10, protein: 0.10, carbs: 0.10, fats: 0.10 },
};

export const SLOT_LABELS = {
  breakfast: "Breakfast",
  lunch:     "Lunch",
  snack1:    "Snack",
  dinner:    "Dinner",
  snack2:    "Evening Snack",
};

function slotTargets(goals) {
  const out = {};
  for (const [slot, split] of Object.entries(SLOT_SPLIT)) {
    out[slot] = {
      calories: Math.round(goals.calories * split.calories),
      protein:  Math.round(goals.protein  * split.protein),
      carbs:    Math.round(goals.carbs    * split.carbs),
      fats:     Math.round(goals.fats     * split.fats),
    };
  }
  return out;
}

function macroScore(macros, targets) {
  const pct = (a, b) => b > 0 ? Math.abs(a - b) / b : 0;
  return pct(macros.calories, targets.calories) * 40
       + pct(macros.protein,  targets.protein)  * 35
       + pct(macros.carbs,    targets.carbs)    * 15
       + pct(macros.fats,     targets.fats)     * 10;
}

function filterRecipes(restrictions = []) {
  if (!restrictions || restrictions.length === 0) return RECIPES;
  return RECIPES.filter(r => restrictions.every(tag => r.tags.includes(tag)));
}

// Fisher-Yates shuffle (seeded by a simple entropy value for consistent-within-session variety)
function shuffle(arr, seed = 0) {
  const a = [...arr];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateMealPlans(goals, restrictions = [], n = 3, seed = 0) {
  if (!goals) return [];
  const eligible = filterRecipes(restrictions);
  const targets  = slotTargets(goals);

  // For each slot: score recipes, then shuffle within score tiers to get variety
  // We divide recipes into "good" (score < 0.3) and "acceptable" (< 0.6) pools,
  // shuffle each pool, and pick 6 candidates — giving the solver more raw material
  const candidates = {};
  for (const slot of SLOTS) {
    const recipeSlot = SLOT_TO_RECIPE[slot];
    const pool = eligible.filter(r => r.slot === recipeSlot);
    const fallback = RECIPES.filter(r => r.slot === recipeSlot);
    const source = pool.length >= 2 ? pool : fallback;

    const scored = source.map(r => ({ ...r, _score: macroScore(r.macros, targets[slot]) }));
    const good   = shuffle(scored.filter(r => r._score < 0.4), seed + slot.length);
    const ok     = shuffle(scored.filter(r => r._score >= 0.4 && r._score < 0.7), seed + slot.length + 7);
    const rest   = shuffle(scored.filter(r => r._score >= 0.7), seed + slot.length + 13);
    candidates[slot] = [...good, ...ok, ...rest].slice(0, 6);
  }

  // Enumerate combinations (max 6^5 = 7776 — fast enough)
  const plans = [];
  for (const b of candidates.breakfast) {
    for (const l of candidates.lunch) {
      for (const s1 of candidates.snack1) {
        for (const d of candidates.dinner) {
          for (const s2 of candidates.snack2) {
            // Avoid same snack recipe in both snack slots
            if (s1.id === s2.id) continue;
            const dayMacros = {
              calories: b.macros.calories + l.macros.calories + s1.macros.calories + d.macros.calories + s2.macros.calories,
              protein:  b.macros.protein  + l.macros.protein  + s1.macros.protein  + d.macros.protein  + s2.macros.protein,
              carbs:    b.macros.carbs    + l.macros.carbs    + s1.macros.carbs    + d.macros.carbs    + s2.macros.carbs,
              fats:     b.macros.fats     + l.macros.fats     + s1.macros.fats     + d.macros.fats     + s2.macros.fats,
            };
            plans.push({ meals: { breakfast:b, lunch:l, snack1:s1, dinner:d, snack2:s2 }, macros:dayMacros, score:macroScore(dayMacros, goals) });
          }
        }
      }
    }
  }

  // Sort by score, deduplicate by combination
  plans.sort((a, b) => a.score - b.score);
  const seen = new Set();
  const top = [];
  for (const p of plans) {
    const key = SLOTS.map(s => p.meals[s].id).join("|");
    if (!seen.has(key)) { seen.add(key); top.push(p); }
    if (top.length >= n) break;
  }
  return top;
}

export function planMacros(plan) {
  return SLOTS.reduce((acc, slot) => {
    const m = plan.meals[slot]?.macros || {};
    return {
      calories: acc.calories + (m.calories || 0),
      protein:  acc.protein  + (m.protein  || 0),
      carbs:    acc.carbs    + (m.carbs    || 0),
      fats:     acc.fats     + (m.fats     || 0),
    };
  }, { calories:0, protein:0, carbs:0, fats:0 });
}

// Swap / browse helpers
// Pure helpers backing the per-meal "Swap" UX in the expanded day plan. They do
// not touch persistence or the generator — they only rank the recipe library for
// a single slot and produce an immutable single-meal replacement. No schema,
// algorithm, or logging changes.

// Best alternate recipes for one meal slot, ranked by macro fit against that
// slot's proportional share of the daily goals, filtered by dietary
// restrictions. The meal currently in that slot — and, for a snack slot, the
// recipe in the *other* snack slot — is excluded so a swap never re-surfaces the
// current pick or creates a duplicate snack. Pass `limit` to cap the list; the
// full ranked list is returned by default (the UI windows it).
export function swapCandidates(goals, restrictions = [], slot, plan, limit = null) {
  if (!goals || !slot || !SLOT_TO_RECIPE[slot]) return [];
  const recipeSlot = SLOT_TO_RECIPE[slot];
  const targets    = slotTargets(goals)[slot];

  const eligible = filterRecipes(restrictions).filter(r => r.slot === recipeSlot);
  // Fall back to the unrestricted pool only if restrictions leave nothing — the
  // generator uses the same guard so the chooser never renders an empty list.
  const source = eligible.length >= 1 ? eligible : RECIPES.filter(r => r.slot === recipeSlot);

  const currentId    = plan?.meals?.[slot]?.id;
  const otherSnackId = slot === "snack1" ? plan?.meals?.snack2?.id
                     : slot === "snack2" ? plan?.meals?.snack1?.id
                     : null;
  const excluded = new Set([currentId, otherSnackId].filter(Boolean));

  const ranked = source
    .filter(r => !excluded.has(r.id))
    .map(r => ({ ...r, _score: macroScore(r.macros, targets) }))
    .sort((a, b) => a._score - b._score);

  return limit == null ? ranked : ranked.slice(0, limit);
}

// Immutably replace a single meal in a generated plan, preserving every other
// slot and recomputing the day macros + fit score. Returns a brand-new plan
// object (safe to hand straight to React setState) and never mutates the input.
export function replaceMealInPlan(plan, slot, recipe, goals) {
  if (!plan || !plan.meals || !slot || !recipe || !SLOTS.includes(slot)) return plan;
  const meals  = { ...plan.meals, [slot]: recipe };
  const macros = planMacros({ meals });
  return { ...plan, meals, macros, score: goals ? macroScore(macros, goals) : plan.score };
}
