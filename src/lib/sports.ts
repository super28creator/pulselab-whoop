/** Sport / activity catalog with emoji + rough MET for strain estimation. */

export type Sport = {
  id: string;
  name: string;
  emoji: string;
  /** Metabolic equivalent — used to estimate load for manually logged blocks. */
  met: number;
  /** Search aliases (Polish + English) */
  aliases?: string[];
};

export const SPORTS: Sport[] = [
  { id: "running", name: "Bieganie", emoji: "🏃", met: 9.8, aliases: ["run", "jog", "bieg"] },
  { id: "gym", name: "Siłownia", emoji: "🏋️", met: 6.0, aliases: ["gym", "weights", "lifting", "trening"] },
  { id: "swimming", name: "Basen", emoji: "🏊", met: 8.3, aliases: ["swim", "plywanie", "pool"] },
  { id: "volleyball", name: "Siatkówka", emoji: "🏐", met: 6.0, aliases: ["volley"] },
  { id: "tennis", name: "Tenis", emoji: "🎾", met: 7.3, aliases: [] },
  { id: "padel", name: "Padel", emoji: "🎾", met: 7.0, aliases: ["paddle"] },
  { id: "football", name: "Piłka nożna", emoji: "⚽", met: 7.0, aliases: ["soccer", "pilka", "nozna"] },
  { id: "basketball", name: "Koszykówka", emoji: "🏀", met: 8.0, aliases: ["basket", "nba"] },
  { id: "cycling", name: "Rower", emoji: "🚴", met: 8.0, aliases: ["bike", "cycling", "kolarstwo"] },
  { id: "walking", name: "Spacer", emoji: "🚶", met: 3.5, aliases: ["walk", "chodzenie"] },
  { id: "hiking", name: "Wędrówka", emoji: "🥾", met: 6.0, aliases: ["hike", "trekking", "gory"] },
  { id: "boxing", name: "Boks", emoji: "🥊", met: 9.0, aliases: ["box", "kickboxing"] },
  { id: "mma", name: "MMA", emoji: "🥋", met: 10.0, aliases: ["bjj", "grappling", "judo"] },
  { id: "yoga", name: "Joga", emoji: "🧘", met: 3.0, aliases: ["yoga", "stretching", "rozciaganie"] },
  { id: "pilates", name: "Pilates", emoji: "🤸", met: 3.5, aliases: [] },
  { id: "crossfit", name: "CrossFit", emoji: "🤾", met: 9.0, aliases: ["wod", "hiit"] },
  { id: "rowing", name: "Wioślarstwo", emoji: "🚣", met: 7.0, aliases: ["row", "erg", "ergometr"] },
  { id: "climbing", name: "Wspinaczka", emoji: "🧗", met: 8.0, aliases: ["bouldering", "climb"] },
  { id: "skiing", name: "Narty", emoji: "⛷️", met: 7.0, aliases: ["ski", "zjazd"] },
  { id: "snowboard", name: "Snowboard", emoji: "🏂", met: 6.0, aliases: [] },
  { id: "skating", name: "Łyżwy", emoji: "⛸️", met: 7.0, aliases: ["skate", "lyzwy"] },
  { id: "rollerblading", name: "Rolki", emoji: "🛼", met: 7.5, aliases: ["roller", "inline"] },
  { id: "surfing", name: "Surfing", emoji: "🏄", met: 5.0, aliases: ["surf"] },
  { id: "golf", name: "Golf", emoji: "⛳", met: 4.8, aliases: [] },
  { id: "badminton", name: "Badminton", emoji: "🏸", met: 5.5, aliases: [] },
  { id: "squash", name: "Squash", emoji: "🎾", met: 8.0, aliases: [] },
  { id: "tabletennis", name: "Tenis stołowy", emoji: "🏓", met: 4.0, aliases: ["ping pong", "pingpong"] },
  { id: "handball", name: "Piłka ręczna", emoji: "🤾", met: 8.0, aliases: ["reczna"] },
  { id: "rugby", name: "Rugby", emoji: "🏉", met: 8.3, aliases: [] },
  { id: "baseball", name: "Baseball", emoji: "⚾", met: 5.0, aliases: [] },
  { id: "hockey", name: "Hokej", emoji: "🏒", met: 8.0, aliases: [] },
  { id: "dancing", name: "Taniec", emoji: "💃", met: 5.5, aliases: ["dance", "taniec"] },
  { id: "martialarts", name: "Sztuki walki", emoji: "🥋", met: 10.0, aliases: ["karate", "taekwondo"] },
  { id: "elliptical", name: "Orbitrek", emoji: "🏃", met: 5.0, aliases: ["cross trainer"] },
  { id: "stairs", name: "Schody", emoji: "🪜", met: 8.0, aliases: ["stairmaster"] },
  { id: "jumprope", name: "Skakanka", emoji: "🤺", met: 11.0, aliases: ["skipping"] },
  { id: "kayaking", name: "Kajak", emoji: "🛶", met: 5.0, aliases: ["kayak", "canoe"] },
  { id: "sup", name: "SUP / Deska", emoji: "🏄", met: 4.0, aliases: ["paddleboard"] },
  { id: "horseriding", name: "Jazda konna", emoji: "🐎", met: 5.5, aliases: ["horse"] },
  { id: "fencing", name: "Szermierka", emoji: "🤺", met: 6.0, aliases: [] },
  { id: "gymnastics", name: "Gimnastyka", emoji: "🤸", met: 4.0, aliases: [] },
  { id: "cardio", name: "Cardio", emoji: "❤️", met: 7.0, aliases: ["aerobic"] },
  { id: "walk_dog", name: "Wyjście z psem", emoji: "🐕", met: 3.0, aliases: ["dog"] },
  { id: "other", name: "Inne", emoji: "⭐", met: 5.0, aliases: ["inny", "custom"] },
];

const BY_ID = new Map(SPORTS.map((s) => [s.id, s]));

export function sportById(id: string): Sport {
  return BY_ID.get(id) ?? SPORTS[SPORTS.length - 1]!;
}

export function searchSports(query: string): Sport[] {
  const q = query.trim().toLowerCase();
  if (!q) return SPORTS;
  return SPORTS.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    if (s.id.includes(q)) return true;
    return (s.aliases ?? []).some((a) => a.toLowerCase().includes(q));
  });
}
