/** Shared helpers for showing pet names when duplicates exist. */

type NamedPet = {
  name: string;
  owner_name?: string | null;
};

type NamedOpdPet = {
  pet_name: string;
  owner_name?: string | null;
};

/** Lowercased pet names that appear more than once in the list. */
export function duplicatePetNameKeys(
  pets: Array<{ name: string }>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const pet of pets) {
    const key = pet.name.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [key, count] of counts) {
    if (count > 1) dupes.add(key);
  }
  return dupes;
}

/**
 * "Bella" → "Bella (Mariyam)" when another pet is also named Bella.
 * Unchanged when the name is unique or owner is missing.
 */
export function formatPetName(
  pet: NamedPet,
  duplicateNames: Set<string>,
): string {
  const owner = pet.owner_name?.trim();
  if (
    owner &&
    duplicateNames.has(pet.name.trim().toLowerCase())
  ) {
    return `${pet.name} (${owner})`;
  }
  return pet.name;
}

export function duplicateOpdPetNameKeys(
  rows: Array<{ pet_name: string }>,
): Set<string> {
  return duplicatePetNameKeys(rows.map((r) => ({ name: r.pet_name })));
}

export function formatOpdPetName(
  row: NamedOpdPet,
  duplicateNames: Set<string>,
): string {
  return formatPetName(
    { name: row.pet_name, owner_name: row.owner_name },
    duplicateNames,
  );
}
