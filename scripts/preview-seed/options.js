// Values the generated demo data may use, mirroring src/lib/registrationOptions.js. Kept free of
// dependencies so Jest can check them against the app's own lists (options.test.js).
export const OPTION_VALUES = {
  sleeping: ['camping', 'floor', 'bed', 'sofa', 'outside_other'],
  bedReason: ['health', 'children', 'comfort', 'other'],
  dietary: ['none', 'vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'other'],
  volunteering: [
    'food_purchase', 'cook_meal', 'dj_afternoon', 'dj_evening', 'setup_friday', 'cleanup_sunday',
    'neighbor_management', 'parking', 'art_initiative', 'pharmacy', 'other'
  ],
  transport: ['offer', 'need'],
  // Where lifts leave from (#181): the start of a postal code, with a note, weighted towards
  // Montreal like the real crowd, plus a few from farther away, so the carpool board (#180) has
  // near and far pairs to rank. Each must be a valid FSA (options.test.js).
  departures: [
    ['H2S', 'métro Jean-Talon', 3],
    ['H2R', 'métro Jarry', 2],
    ['H2J', 'métro Laurier', 3],
    ['H2T', 'Mile End', 2],
    ['H2W', 'métro Mont-Royal', 2],
    ['H1X', 'Rosemont', 2],
    ['H4A', 'NDG', 2],
    ['H3Z', 'Westmount', 1],
    ['H8S', 'Lachine', 1],
    ['H7N', 'Laval', 2],
    ['J4K', 'Longueuil', 2],
    ['J7Y', 'Saint-Jérôme', 1],
    ['G1R', 'Vieux-Québec', 1],
    ['J1H', 'Sherbrooke', 1],
    ['J8X', 'Hull', 1],
    ['K1N', 'Ottawa, marché By', 1]
  ],
  paymentStatus: ['paid', 'unpaid']
};
