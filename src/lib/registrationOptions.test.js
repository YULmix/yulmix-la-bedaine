import { dietaryLabelsOf, dietaryNeedsOf, nextDietaryNeeds } from './registrationOptions';

test('dietaryNeedsOf reads arrays, and single values from older data', () => {
  expect(dietaryNeedsOf(['vegan', 'other'])).toEqual(['vegan', 'other']);
  expect(dietaryNeedsOf('vegan')).toEqual(['vegan']);
  expect(dietaryNeedsOf('')).toEqual([]);
  expect(dietaryNeedsOf(null)).toEqual([]);
});

test('nextDietaryNeeds: « Aucune restriction » clears the others, and the others clear it', () => {
  expect(nextDietaryNeeds(['vegan', 'other'], ['vegan', 'other', 'none'])).toEqual(['none']);
  expect(nextDietaryNeeds(['none'], ['none', 'gluten_free'])).toEqual(['gluten_free']);
});

test('nextDietaryNeeds combines needs in option order, and unticks normally', () => {
  expect(nextDietaryNeeds(['dairy_free'], ['dairy_free', 'gluten_free'])).toEqual(['gluten_free', 'dairy_free']);
  expect(nextDietaryNeeds(['gluten_free', 'dairy_free'], ['dairy_free'])).toEqual(['dairy_free']);
  expect(nextDietaryNeeds(['none'], [])).toEqual([]);
});

test('dietaryLabelsOf: French labels, « Autre » as written, nothing for « Aucune restriction »', () => {
  expect(dietaryLabelsOf({ dietary_needs: ['gluten_free', 'dairy_free', 'other'], dietary_other: 'Noix' }))
    .toEqual(['Sans gluten', 'Sans produits laitiers', 'Noix']);
  expect(dietaryLabelsOf({ dietary_needs: ['none'] })).toEqual([]);
  expect(dietaryLabelsOf({ dietary_needs: 'vegan' })).toEqual(['Végétalien']);
});
