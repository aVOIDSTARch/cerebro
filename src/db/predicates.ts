import { getQuarantineDb } from "../quarantine/schema.js";

export interface PredicateEntry {
  canonical: string;
  aliases: string[];
  domain: string | null;
  inverse: string | null;
  description: string | null;
}

export function bootstrapPredicateRegistry(): void {
  const db = getQuarantineDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS predicate_registry (
      canonical   TEXT PRIMARY KEY,
      aliases     TEXT NOT NULL DEFAULT '[]',
      domain      TEXT,
      inverse     TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_predicates (
      predicate   TEXT PRIMARY KEY,
      first_seen  TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1
    );
  `);

  console.log("Predicate registry bootstrapped.");
}

export function seedPredicates(): void {
  const db = getQuarantineDb();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO predicate_registry (canonical, aliases, domain, inverse, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  const seeds: [string, string[], string | null, string | null, string | null][] = [
    // General relationships
    ["causes", ["caused_by", "is_cause_of"], "general", "caused_by", "Causal relationship"],
    ["caused_by", ["is_caused_by"], "general", "causes", "Inverse causal relationship"],
    ["influences", ["influenced", "has_influence_on", "affects"], "general", "influenced_by", "Non-causal influence"],
    ["influenced_by", ["is_influenced_by", "affected_by"], "general", "influences", "Inverse influence"],
    ["contains", ["includes", "has_part", "comprises"], "general", "part_of", "Containment or composition"],
    ["part_of", ["is_part_of", "belongs_to", "component_of"], "general", "contains", "Inverse containment"],
    ["is_a", ["is_type_of", "is_kind_of", "type_of"], "general", null, "Type/class membership"],
    ["instance_of", ["is_instance_of"], "general", null, "Instance of a class"],
    ["related_to", ["associated_with", "connected_to"], "general", "related_to", "General association"],
    ["precedes", ["comes_before", "before"], "temporal", "follows", "Temporal ordering"],
    ["follows", ["comes_after", "after", "succeeds"], "temporal", "precedes", "Inverse temporal ordering"],
    ["contradicts", ["conflicts_with", "opposes", "refutes"], "epistemic", "contradicted_by", "Contradictory relationship"],
    ["contradicted_by", ["refuted_by", "opposed_by"], "epistemic", "contradicts", "Inverse contradiction"],
    ["supports", ["corroborates", "confirms", "validates"], "epistemic", "supported_by", "Evidential support"],
    ["supported_by", ["corroborated_by", "confirmed_by"], "epistemic", "supports", "Inverse evidential support"],
    ["derives_from", ["derived_from", "originates_from"], "general", "gives_rise_to", "Origin or derivation"],
    ["gives_rise_to", ["produces", "leads_to", "results_in"], "general", "derives_from", "Production or consequence"],
    ["located_in", ["found_in", "situated_in", "in"], "spatial", "location_of", "Spatial location"],
    ["location_of", ["contains_location"], "spatial", "located_in", "Inverse spatial location"],
    ["created_by", ["authored_by", "made_by", "invented_by"], "general", "created", "Authorship or creation"],
    ["created", ["authored", "made", "invented"], "general", "created_by", "Inverse creation"],
    ["member_of", ["belongs_to_group"], "general", "has_member", "Group membership"],
    ["has_member", ["includes_member"], "general", "member_of", "Inverse group membership"],
    ["equivalent_to", ["same_as", "identical_to", "equals"], "general", "equivalent_to", "Equivalence"],
    ["has_property", ["has_attribute", "has_characteristic"], "general", null, "Property assignment"],
    ["used_by", ["employed_by", "utilized_by"], "general", "uses", "Usage relationship"],
    ["uses", ["employs", "utilizes"], "general", "used_by", "Inverse usage"],
    ["depends_on", ["requires", "needs"], "general", "depended_on_by", "Dependency"],
    ["depended_on_by", ["required_by", "needed_by"], "general", "depends_on", "Inverse dependency"],
    ["inhibits", ["blocks", "prevents", "suppresses"], "biology", "inhibited_by", "Inhibition"],
    ["inhibited_by", ["blocked_by", "prevented_by", "suppressed_by"], "biology", "inhibits", "Inverse inhibition"],
    ["activates", ["triggers", "stimulates", "induces"], "biology", "activated_by", "Activation"],
    ["activated_by", ["triggered_by", "stimulated_by", "induced_by"], "biology", "activates", "Inverse activation"],
    ["treats", ["therapy_for", "treatment_for"], "medicine", "treated_by", "Therapeutic relationship"],
    ["treated_by", ["has_treatment"], "medicine", "treats", "Inverse therapeutic"],
    ["symptom_of", ["sign_of", "manifestation_of"], "medicine", "has_symptom", "Symptom relationship"],
    ["has_symptom", ["presents_with"], "medicine", "symptom_of", "Inverse symptom"],
    ["contemporary_of", ["lived_same_era", "contemporaneous_with"], "history", "contemporary_of", "Temporal contemporaneity"],
    ["succeeded_by", ["replaced_by"], "history", "successor_of", "Succession"],
    ["successor_of", ["succeeded", "replaced"], "history", "succeeded_by", "Inverse succession"],
  ];

  const insertMany = db.transaction(() => {
    for (const [canonical, aliases, domain, inverse, description] of seeds) {
      insert.run(canonical, JSON.stringify(aliases), domain, inverse, description);
    }
  });
  insertMany();

  console.log(`Predicate registry seeded with ${seeds.length} predicates.`);
}

/**
 * Normalize a predicate string against the registry.
 * Returns the canonical form if found, otherwise records it as pending and returns the input.
 */
export function normalizePredicate(input: string): string {
  const db = getQuarantineDb();
  const normalized = input.toLowerCase().trim().replace(/\s+/g, "_");

  // Check if it's already a canonical predicate
  const canonical = db
    .prepare("SELECT canonical FROM predicate_registry WHERE canonical = ?")
    .get(normalized) as { canonical: string } | undefined;
  if (canonical) return canonical.canonical;

  // Check aliases
  const allPredicates = db
    .prepare("SELECT canonical, aliases FROM predicate_registry")
    .all() as { canonical: string; aliases: string }[];

  for (const row of allPredicates) {
    const aliases: string[] = JSON.parse(row.aliases);
    if (aliases.includes(normalized)) {
      return row.canonical;
    }
  }

  // Not found — record as pending
  db.prepare(`
    INSERT INTO pending_predicates (predicate, first_seen, occurrences)
    VALUES (?, ?, 1)
    ON CONFLICT(predicate) DO UPDATE SET occurrences = occurrences + 1
  `).run(normalized, new Date().toISOString());

  return normalized;
}

export function getPendingPredicates(): { predicate: string; first_seen: string; occurrences: number }[] {
  const db = getQuarantineDb();
  return db
    .prepare("SELECT * FROM pending_predicates ORDER BY occurrences DESC")
    .all() as { predicate: string; first_seen: string; occurrences: number }[];
}

export function addPredicate(entry: PredicateEntry): void {
  const db = getQuarantineDb();
  db.prepare(`
    INSERT OR REPLACE INTO predicate_registry (canonical, aliases, domain, inverse, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    entry.canonical,
    JSON.stringify(entry.aliases),
    entry.domain,
    entry.inverse,
    entry.description,
  );

  // Remove from pending if it was there
  db.prepare("DELETE FROM pending_predicates WHERE predicate = ?").run(entry.canonical);
  for (const alias of entry.aliases) {
    db.prepare("DELETE FROM pending_predicates WHERE predicate = ?").run(alias);
  }
}
