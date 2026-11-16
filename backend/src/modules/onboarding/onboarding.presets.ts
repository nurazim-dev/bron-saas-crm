import { BusinessType } from '../../generated/prisma/client.js';

export interface ServicePreset {
  id: string;
  businessType: BusinessType;
  name: string;
  durationMin: number;
  price: string;
}

export const SERVICE_PRESETS: ServicePreset[] = [
  // BARBERSHOP
  {
    id: 'barber-mens-haircut',
    businessType: BusinessType.BARBERSHOP,
    name: 'Мужская стрижка',
    durationMin: 45,
    price: '600.00',
  },
  {
    id: 'barber-clipper-cut',
    businessType: BusinessType.BARBERSHOP,
    name: 'Стрижка машинкой',
    durationMin: 30,
    price: '400.00',
  },
  {
    id: 'barber-beard-trim',
    businessType: BusinessType.BARBERSHOP,
    name: 'Моделирование бороды',
    durationMin: 30,
    price: '400.00',
  },
  {
    id: 'barber-combo',
    businessType: BusinessType.BARBERSHOP,
    name: 'Стрижка + борода',
    durationMin: 60,
    price: '900.00',
  },
  {
    id: 'barber-kids-cut',
    businessType: BusinessType.BARBERSHOP,
    name: 'Детская стрижка',
    durationMin: 30,
    price: '450.00',
  },
  {
    id: 'barber-royal-shave',
    businessType: BusinessType.BARBERSHOP,
    name: 'Королевское бритьё',
    durationMin: 45,
    price: '500.00',
  },
  {
    id: 'barber-styling',
    businessType: BusinessType.BARBERSHOP,
    name: 'Укладка волос',
    durationMin: 20,
    price: '300.00',
  },

  // BEAUTY_SALON
  {
    id: 'salon-womens-haircut',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Женская стрижка',
    durationMin: 60,
    price: '1000.00',
  },
  {
    id: 'salon-coloring',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Окрашивание волос',
    durationMin: 120,
    price: '3500.00',
  },
  {
    id: 'salon-styling',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Укладка',
    durationMin: 45,
    price: '800.00',
  },
  {
    id: 'salon-manicure',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Маникюр с покрытием',
    durationMin: 90,
    price: '1200.00',
  },
  {
    id: 'salon-pedicure',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Педикюр',
    durationMin: 90,
    price: '1500.00',
  },
  {
    id: 'salon-brows',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Коррекция и окрашивание бровей',
    durationMin: 45,
    price: '700.00',
  },
  {
    id: 'salon-lashes',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Наращивание ресниц',
    durationMin: 120,
    price: '2000.00',
  },
  {
    id: 'salon-facial',
    businessType: BusinessType.BEAUTY_SALON,
    name: 'Чистка лица',
    durationMin: 60,
    price: '1800.00',
  },
];

export function getPresetsForBusinessType(businessType: BusinessType): ServicePreset[] {
  return SERVICE_PRESETS.filter((p) => p.businessType === businessType);
}
