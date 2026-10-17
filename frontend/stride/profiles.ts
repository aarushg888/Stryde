export type ProfileId = 'walking' | 'wheelchair' | 'stroller' | 'lowvision';

export type Profile = {
  id: ProfileId;
  label: string;
  // OpenRouteService routing profile used for the "accessible" route.
  // null means no separate accessible route is needed.
  orsProfile: 'wheelchair' | null;
  note: string;
};

export const PROFILES: Profile[] = [
  { id: 'walking', label: 'Walking', orsProfile: null, note: 'Standard walking route.' },
  {
    id: 'wheelchair',
    label: 'Wheelchair',
    orsProfile: 'wheelchair',
    note: 'Avoids steep slopes and high curbs.',
  },
  {
    id: 'stroller',
    label: 'Stroller',
    orsProfile: 'wheelchair',
    note: 'Uses the wheelchair profile for now: smooth surfaces, gentle slopes.',
  },
  {
    id: 'lowvision',
    label: 'Low vision',
    orsProfile: null,
    note: 'Standard route for now. Lighting and crossing data come later.',
  },
];
