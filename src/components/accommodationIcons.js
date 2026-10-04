import { Ban, BedDouble, Caravan, Layers, Leaf, MilkOff, Sofa, Sprout, Tent, Utensils, WheatOff } from 'lucide-react';

// The icons of the form's fixed lists, shared by the registration form, the recap and the admin's
// « Participants » view, so a value looks the same everywhere.

// One icon per sleeping type (ACCOMMODATION_OPTIONS values, also event_places.type).
export const ACCOMMODATION_ICONS = { camping: Tent, floor: Layers, bed: BedDouble, sofa: Sofa, outside_other: Caravan };

// One icon per dietary need (DIETARY_OPTIONS values).
export const DIETARY_ICONS = { none: Ban, vegetarian: Leaf, vegan: Sprout, gluten_free: WheatOff, dairy_free: MilkOff, other: Utensils };
