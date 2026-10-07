// Les grandes villes du monde et leur fuseau horaire (nom IANA, comme
// « Europe/Paris »), pour les horloges du monde (onglet Système) et les
// heures du Lanceur (« 15 h Montréal », « heure à Tokyo »).
//
// Une liste FIXE écrite ici : rien n'est demandé sur Internet. Les heures sont
// calculées par Windows (Intl.DateTimeFormat et son fuseau), voir world-time.ts.
//
// On cherche une ville sans tenir compte des majuscules, des accents, des
// tirets ni des apostrophes : « montreal », « Saint Petersbourg », « sao paulo ».
// Chaque ville a son nom français, son nom anglais et parfois d'autres noms
// (« Bombay » pour Mumbai). On accepte aussi un nom IANA tapé tel quel
// (« America/Argentina/Cordoba ») et « UTC ».
//
// Pur (aucun DOM) : testé dans tests/front/world-time.test.ts.

/** Une ville : son nom en français et en anglais, et son fuseau IANA. */
export interface City {
  fr: string;
  en: string;
  tz: string;
}

/** Au plus 4 horloges dans l'onglet Système. */
export const MAX_CLOCKS = 4;

// [nom français, nom anglais, fuseau IANA, autres noms acceptés…]
// Quand le fuseau d'une ville n'a pas son propre nom IANA, on prend celui de
// la grande ville du même fuseau (Montréal → America/Toronto).
const TABLE: [string, string, string, ...string[]][] = [
  // Temps universel : utile pour lire un journal de serveur.
  ["UTC", "UTC", "UTC", "GMT", "temps universel", "Z"],

  // Europe
  ["Paris", "Paris", "Europe/Paris"],
  ["Lyon", "Lyon", "Europe/Paris"],
  ["Marseille", "Marseille", "Europe/Paris", "Marseilles"],
  ["Toulouse", "Toulouse", "Europe/Paris"],
  ["Londres", "London", "Europe/London"],
  ["Manchester", "Manchester", "Europe/London"],
  ["Édimbourg", "Edinburgh", "Europe/London"],
  ["Dublin", "Dublin", "Europe/Dublin"],
  ["Lisbonne", "Lisbon", "Europe/Lisbon", "Lisboa"],
  ["Madrid", "Madrid", "Europe/Madrid"],
  ["Barcelone", "Barcelona", "Europe/Madrid"],
  ["Bruxelles", "Brussels", "Europe/Brussels", "Brussel"],
  ["Amsterdam", "Amsterdam", "Europe/Amsterdam"],
  ["Luxembourg", "Luxembourg", "Europe/Luxembourg"],
  ["Monaco", "Monaco", "Europe/Monaco"],
  ["Genève", "Geneva", "Europe/Zurich", "Genf"],
  ["Zurich", "Zurich", "Europe/Zurich", "Zürich"],
  ["Berne", "Bern", "Europe/Zurich"],
  ["Berlin", "Berlin", "Europe/Berlin"],
  ["Munich", "Munich", "Europe/Berlin", "München"],
  ["Francfort", "Frankfurt", "Europe/Berlin"],
  ["Hambourg", "Hamburg", "Europe/Berlin"],
  ["Vienne", "Vienna", "Europe/Vienna", "Wien"],
  ["Rome", "Rome", "Europe/Rome", "Roma"],
  ["Milan", "Milan", "Europe/Rome", "Milano"],
  ["Copenhague", "Copenhagen", "Europe/Copenhagen", "København"],
  ["Oslo", "Oslo", "Europe/Oslo"],
  ["Stockholm", "Stockholm", "Europe/Stockholm"],
  ["Helsinki", "Helsinki", "Europe/Helsinki"],
  ["Reykjavik", "Reykjavik", "Atlantic/Reykjavik", "Reykjavík"],
  ["Varsovie", "Warsaw", "Europe/Warsaw", "Warszawa"],
  ["Prague", "Prague", "Europe/Prague", "Praha"],
  ["Bratislava", "Bratislava", "Europe/Bratislava"],
  ["Budapest", "Budapest", "Europe/Budapest"],
  ["Ljubljana", "Ljubljana", "Europe/Ljubljana"],
  ["Zagreb", "Zagreb", "Europe/Zagreb"],
  ["Belgrade", "Belgrade", "Europe/Belgrade", "Beograd"],
  ["Bucarest", "Bucharest", "Europe/Bucharest", "București"],
  ["Sofia", "Sofia", "Europe/Sofia"],
  ["Athènes", "Athens", "Europe/Athens"],
  ["Istanbul", "Istanbul", "Europe/Istanbul"],
  ["Kiev", "Kyiv", "Europe/Kiev", "Kyiv", "Kiev", "Kyïv"],
  ["Minsk", "Minsk", "Europe/Minsk"],
  ["Riga", "Riga", "Europe/Riga"],
  ["Vilnius", "Vilnius", "Europe/Vilnius"],
  ["Tallinn", "Tallinn", "Europe/Tallinn"],
  ["Moscou", "Moscow", "Europe/Moscow", "Moskva"],
  ["Saint-Pétersbourg", "Saint Petersburg", "Europe/Moscow", "St Petersburg", "Saint Petersbourg"],

  // France d'outre-mer
  ["Fort-de-France", "Fort-de-France", "America/Martinique", "Martinique"],
  ["Pointe-à-Pitre", "Pointe-à-Pitre", "America/Guadeloupe", "Guadeloupe"],
  ["Cayenne", "Cayenne", "America/Cayenne", "Guyane"],
  ["Saint-Pierre-et-Miquelon", "Saint Pierre and Miquelon", "America/Miquelon", "Miquelon"],
  ["La Réunion", "Réunion", "Indian/Reunion", "Saint-Denis de La Réunion", "Reunion", "Reunion Island"],
  ["Mamoudzou", "Mamoudzou", "Indian/Mayotte", "Mayotte"],
  ["Nouméa", "Noumea", "Pacific/Noumea", "Nouvelle-Calédonie", "New Caledonia"],
  ["Papeete", "Papeete", "Pacific/Tahiti", "Tahiti"],

  // Afrique
  ["Alger", "Algiers", "Africa/Algiers"],
  ["Tunis", "Tunis", "Africa/Tunis"],
  ["Casablanca", "Casablanca", "Africa/Casablanca"],
  ["Rabat", "Rabat", "Africa/Casablanca"],
  ["Tripoli", "Tripoli", "Africa/Tripoli"],
  ["Le Caire", "Cairo", "Africa/Cairo", "Caire"],
  ["Khartoum", "Khartoum", "Africa/Khartoum"],
  ["Dakar", "Dakar", "Africa/Dakar"],
  ["Bamako", "Bamako", "Africa/Bamako"],
  ["Abidjan", "Abidjan", "Africa/Abidjan"],
  ["Accra", "Accra", "Africa/Accra"],
  ["Lagos", "Lagos", "Africa/Lagos"],
  ["Douala", "Douala", "Africa/Douala"],
  ["Yaoundé", "Yaounde", "Africa/Douala"],
  ["Kinshasa", "Kinshasa", "Africa/Kinshasa"],
  ["Luanda", "Luanda", "Africa/Luanda"],
  ["Addis-Abeba", "Addis Ababa", "Africa/Addis_Ababa"],
  ["Nairobi", "Nairobi", "Africa/Nairobi"],
  ["Dar es Salam", "Dar es Salaam", "Africa/Dar_es_Salaam"],
  ["Johannesburg", "Johannesburg", "Africa/Johannesburg"],
  ["Le Cap", "Cape Town", "Africa/Johannesburg"],
  ["Tananarive", "Antananarivo", "Indian/Antananarivo", "Antananarivo"],
  ["Port-Louis", "Port Louis", "Indian/Mauritius", "Maurice", "Mauritius", "Île Maurice"],

  // Moyen-Orient et Caucase
  ["Jérusalem", "Jerusalem", "Asia/Jerusalem"],
  ["Tel Aviv", "Tel Aviv", "Asia/Jerusalem", "Tel-Aviv"],
  ["Beyrouth", "Beirut", "Asia/Beirut"],
  ["Amman", "Amman", "Asia/Amman"],
  ["Damas", "Damascus", "Asia/Damascus"],
  ["Bagdad", "Baghdad", "Asia/Baghdad"],
  ["Riyad", "Riyadh", "Asia/Riyadh"],
  ["Djeddah", "Jeddah", "Asia/Riyadh"],
  ["Koweït", "Kuwait City", "Asia/Kuwait", "Kuwait"],
  ["Manama", "Manama", "Asia/Bahrain", "Bahreïn", "Bahrain"],
  ["Doha", "Doha", "Asia/Qatar"],
  ["Dubaï", "Dubai", "Asia/Dubai"],
  ["Abou Dabi", "Abu Dhabi", "Asia/Dubai"],
  ["Mascate", "Muscat", "Asia/Muscat"],
  ["Téhéran", "Tehran", "Asia/Tehran"],
  ["Bakou", "Baku", "Asia/Baku"],
  ["Tbilissi", "Tbilisi", "Asia/Tbilisi"],
  ["Erevan", "Yerevan", "Asia/Yerevan"],

  // Asie
  ["Kaboul", "Kabul", "Asia/Kabul"],
  ["Karachi", "Karachi", "Asia/Karachi"],
  ["Islamabad", "Islamabad", "Asia/Karachi"],
  ["Lahore", "Lahore", "Asia/Karachi"],
  ["Tachkent", "Tashkent", "Asia/Tashkent"],
  ["Almaty", "Almaty", "Asia/Almaty"],
  ["Iekaterinbourg", "Yekaterinburg", "Asia/Yekaterinburg"],
  ["New Delhi", "New Delhi", "Asia/Kolkata", "Delhi"],
  ["Bombay", "Mumbai", "Asia/Kolkata", "Mumbai"],
  ["Bangalore", "Bengaluru", "Asia/Kolkata", "Bengaluru"],
  ["Calcutta", "Kolkata", "Asia/Kolkata", "Kolkata"],
  ["Chennai", "Chennai", "Asia/Kolkata", "Madras"],
  ["Hyderabad", "Hyderabad", "Asia/Kolkata"],
  ["Pune", "Pune", "Asia/Kolkata"],
  ["Colombo", "Colombo", "Asia/Colombo"],
  ["Katmandou", "Kathmandu", "Asia/Kathmandu"],
  ["Dacca", "Dhaka", "Asia/Dhaka", "Dhaka"],
  ["Rangoun", "Yangon", "Asia/Yangon", "Rangoon"],
  ["Bangkok", "Bangkok", "Asia/Bangkok"],
  ["Hanoï", "Hanoi", "Asia/Ho_Chi_Minh"],
  ["Hô Chi Minh-Ville", "Ho Chi Minh City", "Asia/Ho_Chi_Minh", "Saïgon", "Saigon", "Ho Chi Minh"],
  ["Phnom Penh", "Phnom Penh", "Asia/Phnom_Penh"],
  ["Kuala Lumpur", "Kuala Lumpur", "Asia/Kuala_Lumpur"],
  ["Singapour", "Singapore", "Asia/Singapore"],
  ["Jakarta", "Jakarta", "Asia/Jakarta"],
  ["Manille", "Manila", "Asia/Manila"],
  ["Hong Kong", "Hong Kong", "Asia/Hong_Kong"],
  ["Macao", "Macau", "Asia/Macau", "Macau"],
  ["Pékin", "Beijing", "Asia/Shanghai", "Peking", "Beijing"],
  ["Shanghai", "Shanghai", "Asia/Shanghai", "Shanghaï"],
  ["Shenzhen", "Shenzhen", "Asia/Shanghai"],
  ["Canton", "Guangzhou", "Asia/Shanghai", "Guangzhou"],
  ["Chengdu", "Chengdu", "Asia/Shanghai"],
  ["Taipei", "Taipei", "Asia/Taipei", "Taïpei"],
  ["Séoul", "Seoul", "Asia/Seoul"],
  ["Tokyo", "Tokyo", "Asia/Tokyo"],
  ["Osaka", "Osaka", "Asia/Tokyo"],
  ["Kyoto", "Kyoto", "Asia/Tokyo"],
  ["Oulan-Bator", "Ulaanbaatar", "Asia/Ulaanbaatar", "Oulan Bator", "Ulan Bator"],
  ["Novossibirsk", "Novosibirsk", "Asia/Novosibirsk"],
  ["Vladivostok", "Vladivostok", "Asia/Vladivostok"],

  // Océanie et Pacifique
  ["Perth", "Perth", "Australia/Perth"],
  ["Darwin", "Darwin", "Australia/Darwin"],
  ["Adélaïde", "Adelaide", "Australia/Adelaide"],
  ["Brisbane", "Brisbane", "Australia/Brisbane"],
  ["Sydney", "Sydney", "Australia/Sydney"],
  ["Canberra", "Canberra", "Australia/Sydney"],
  ["Melbourne", "Melbourne", "Australia/Melbourne"],
  ["Auckland", "Auckland", "Pacific/Auckland"],
  ["Wellington", "Wellington", "Pacific/Auckland"],
  ["Suva", "Suva", "Pacific/Fiji", "Fidji", "Fiji"],
  ["Honolulu", "Honolulu", "Pacific/Honolulu", "Hawaï", "Hawaii"],

  // Amérique du Nord
  ["Montréal", "Montreal", "America/Toronto"],
  ["Québec", "Quebec City", "America/Toronto", "Quebec"],
  ["Ottawa", "Ottawa", "America/Toronto"],
  ["Toronto", "Toronto", "America/Toronto"],
  ["Halifax", "Halifax", "America/Halifax"],
  ["Saint-Jean de Terre-Neuve", "St. John's", "America/St_Johns", "St John's", "Saint John's", "Terre-Neuve", "Newfoundland"],
  ["Winnipeg", "Winnipeg", "America/Winnipeg"],
  ["Calgary", "Calgary", "America/Edmonton"],
  ["Edmonton", "Edmonton", "America/Edmonton"],
  ["Vancouver", "Vancouver", "America/Vancouver"],
  ["New York", "New York", "America/New_York", "NYC", "New York City"],
  ["Washington", "Washington", "America/New_York", "Washington DC", "Washington D.C."],
  ["Boston", "Boston", "America/New_York"],
  ["Philadelphie", "Philadelphia", "America/New_York"],
  ["Atlanta", "Atlanta", "America/New_York"],
  ["Miami", "Miami", "America/New_York"],
  ["Détroit", "Detroit", "America/Detroit"],
  ["Chicago", "Chicago", "America/Chicago"],
  ["Minneapolis", "Minneapolis", "America/Chicago"],
  ["Dallas", "Dallas", "America/Chicago"],
  ["Houston", "Houston", "America/Chicago"],
  ["Austin", "Austin", "America/Chicago"],
  ["La Nouvelle-Orléans", "New Orleans", "America/Chicago", "Nouvelle-Orléans"],
  ["Denver", "Denver", "America/Denver"],
  ["Salt Lake City", "Salt Lake City", "America/Denver"],
  ["Phoenix", "Phoenix", "America/Phoenix"],
  ["Las Vegas", "Las Vegas", "America/Los_Angeles"],
  ["Los Angeles", "Los Angeles", "America/Los_Angeles"],
  ["San Diego", "San Diego", "America/Los_Angeles"],
  ["San Francisco", "San Francisco", "America/Los_Angeles"],
  ["San José (Californie)", "San Jose (California)", "America/Los_Angeles", "San José", "San Jose", "Silicon Valley"],
  ["Seattle", "Seattle", "America/Los_Angeles"],
  ["Anchorage", "Anchorage", "America/Anchorage", "Alaska"],
  ["Mexico", "Mexico City", "America/Mexico_City", "Ciudad de México"],
  ["Monterrey", "Monterrey", "America/Monterrey"],
  ["Cancún", "Cancun", "America/Cancun"],

  // Amérique centrale et Caraïbes
  ["Guatemala", "Guatemala City", "America/Guatemala"],
  ["San José (Costa Rica)", "San José (Costa Rica)", "America/Costa_Rica", "Costa Rica"],
  ["Panama", "Panama City", "America/Panama"],
  ["La Havane", "Havana", "America/Havana", "Havane"],
  ["Port-au-Prince", "Port-au-Prince", "America/Port-au-Prince", "Haïti", "Haiti"],
  ["Saint-Domingue", "Santo Domingo", "America/Santo_Domingo"],
  ["San Juan", "San Juan", "America/Puerto_Rico", "Porto Rico", "Puerto Rico"],

  // Amérique du Sud
  ["Bogota", "Bogotá", "America/Bogota"],
  ["Caracas", "Caracas", "America/Caracas"],
  ["Quito", "Quito", "America/Guayaquil"],
  ["Lima", "Lima", "America/Lima"],
  ["La Paz", "La Paz", "America/La_Paz"],
  ["Santiago du Chili", "Santiago", "America/Santiago", "Santiago de Chile"],
  ["Buenos Aires", "Buenos Aires", "America/Argentina/Buenos_Aires"],
  ["Montevideo", "Montevideo", "America/Montevideo"],
  ["Asuncion", "Asunción", "America/Asuncion"],
  ["São Paulo", "São Paulo", "America/Sao_Paulo"],
  ["Rio de Janeiro", "Rio de Janeiro", "America/Sao_Paulo", "Rio"],
  ["Brasilia", "Brasília", "America/Sao_Paulo"],
];

/** « Saint-Pétersbourg » → « saint petersbourg » : sans accents, majuscules, tirets ni apostrophes. */
export function cityKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/[-'’.,()_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Toutes les villes, une seule fois chacune (pour les tests et l'aide). */
export const CITIES: readonly City[] = TABLE.map(([fr, en, tz]) => ({ fr, en, tz }));

/** Chaque nom accepté (déjà passé par cityKey) → sa ville. Le premier arrivé garde son nom. */
const BY_NAME = new Map<string, City>();
TABLE.forEach(([fr, en, , ...aliases], i) => {
  for (const name of [fr, en, ...aliases]) {
    const key = cityKey(name);
    if (key && !BY_NAME.has(key)) BY_NAME.set(key, CITIES[i]);
  }
});

/** Le fuseau IANA est-il connu de ce Windows ? */
function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * La ville qui porte ce nom, ou null. Un nom IANA (« Asia/Kathmandu ») est
 * accepté s'il est valide : la ville porte alors le dernier morceau du nom.
 */
export function findCity(name: string): City | null {
  const key = cityKey(name);
  if (!key) return null;
  const known = BY_NAME.get(key);
  if (known) return known;
  const raw = name.trim();
  if (/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(raw) && validZone(raw)) {
    const last = raw.split("/").pop()!.replace(/_/g, " ");
    return { fr: last, en: last, tz: raw };
  }
  return null;
}

/** Le nom à afficher dans la langue de l'interface. */
export function cityName(city: City, lang: "fr" | "en"): string {
  return lang === "en" ? city.en : city.fr;
}

/**
 * Lit le réglage « Horloges du monde » : des noms séparés par des virgules (ou
 * des points-virgules). Renvoie les villes trouvées (MAX_CLOCKS au plus, sans
 * doublon), les noms inconnus, et ceux qui dépassent la limite.
 */
export function parseCityList(text: string, max = MAX_CLOCKS): { cities: City[]; unknown: string[]; extra: string[] } {
  const cities: City[] = [];
  const unknown: string[] = [];
  const extra: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const name = raw.trim();
    if (!name) continue;
    const city = findCity(name);
    if (!city) unknown.push(name);
    else if (cities.includes(city)) continue;
    else if (cities.length >= max) extra.push(name);
    else cities.push(city);
  }
  return { cities, unknown, extra };
}

/**
 * La ville du PC, d'après son fuseau (« Europe/Paris » → Paris), ou null si
 * le fuseau n'est pas dans la liste.
 */
export function localCity(tz = localZone()): City | null {
  return CITIES.find((c) => c.tz === tz) ?? null;
}

/** Le fuseau IANA du PC (« Europe/Paris »), ou "" si Windows ne le dit pas. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
