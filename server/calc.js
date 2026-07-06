// Target calculations. Everything internal is metric (kg, cm, ml); the client converts for display.

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,   // desk job, little exercise
  light: 1.375,     // light exercise 1-3 days/week
  moderate: 1.55,   // moderate exercise 3-5 days/week
  very: 1.725,      // hard exercise 6-7 days/week
  extreme: 1.9,     // physical job + hard training
};

// g protein per kg bodyweight, by goal (evidence-based 1.6-2.2 range)
const PROTEIN_PER_KG = { lose: 2.0, maintain: 1.6, gain: 1.8 };
const CALORIE_ADJUST = { lose: -450, maintain: 0, gain: +300 };

export function ageFromBirthdate(birthdate, onDate = new Date()) {
  const b = new Date(birthdate + 'T00:00:00');
  let age = onDate.getFullYear() - b.getFullYear();
  const m = onDate.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && onDate.getDate() < b.getDate())) age--;
  return age;
}

// Mifflin-St Jeor BMR
export function bmr({ sex, age, weightKg, heightCm }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function computeTargets(profile, weightKg) {
  const age = ageFromBirthdate(profile.birthdate);
  const rest = bmr({ sex: profile.sex, age, weightKg, heightCm: profile.height_cm });
  const tdee = rest * (ACTIVITY_FACTORS[profile.activity] ?? 1.4);
  let calories = Math.round((tdee + (CALORIE_ADJUST[profile.goal] ?? 0)) / 10) * 10;
  // Safety floors (never recommend starvation-level intake)
  calories = Math.max(calories, profile.sex === 'male' ? 1500 : 1200);

  const protein_g = Math.round(weightKg * (PROTEIN_PER_KG[profile.goal] ?? 1.6));
  const fat_g = Math.round(weightKg * 0.8);
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  // AHA added-sugar guideline: ~36 g men / ~25 g women
  const sugar_g = profile.sex === 'male' ? 36 : 25;
  // ~35 ml per kg, rounded to a friendly 250 ml step
  const water_ml = Math.round((weightKg * 35) / 250) * 250;

  return {
    calories, protein_g, carbs_g, fat_g, sugar_g, water_ml,
    bmr: Math.round(rest), tdee: Math.round(tdee), age,
  };
}

export function bmi(weightKg, heightCm) {
  const m = heightCm / 100;
  return +(weightKg / (m * m)).toFixed(1);
}

// Epley estimated one-rep max
export function est1RM(weightKg, reps) {
  if (!weightKg || !reps) return 0;
  if (reps === 1) return weightKg;
  return +(weightKg * (1 + reps / 30)).toFixed(1);
}
