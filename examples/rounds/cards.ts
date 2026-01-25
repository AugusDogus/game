/**
 * ROUNDS card definitions
 *
 * Cards modify player stats and create emergent gameplay.
 * The loser of each round picks a card, creating a catch-up mechanic.
 */

import type { Card, CardRarity, PlayerStats, CardStatModifiers } from "./types.js";
import { DEFAULT_PLAYER_STATS } from "./types.js";

// =============================================================================
// Card Definitions
// =============================================================================

/** All cards in the game */
export const CARDS: Card[] = [
  // =========== OFFENSE CARDS ===========
  {
    id: "damage_up",
    name: "Damage Up",
    description: "+50% bullet damage",
    rarity: "common",
    category: "offense",
    modifiers: { damageMult: 1.5 },
  },
  {
    id: "rapid_fire",
    name: "Rapid Fire",
    description: "+40% fire rate",
    rarity: "common",
    category: "offense",
    modifiers: { fireRateMult: 1.4 },
  },
  {
    id: "big_bullets",
    name: "Big Bullets",
    description: "+75% bullet size",
    rarity: "uncommon",
    category: "offense",
    modifiers: { bulletSizeMult: 1.75 },
  },
  {
    id: "scatter_shot",
    name: "Scatter Shot",
    description: "+2 bullets, +15° spread, -25% damage",
    rarity: "uncommon",
    category: "offense",
    modifiers: { bulletCountAdd: 2, bulletSpreadAdd: 15, damageMult: 0.75 },
  },
  {
    id: "bouncy_bullets",
    name: "Bouncy Bullets",
    description: "Bullets bounce 2 times",
    rarity: "rare",
    category: "offense",
    modifiers: { bulletBouncesAdd: 2 },
  },
  {
    id: "explosive",
    name: "Explosive",
    description: "Bullets explode on impact (40px radius)",
    rarity: "rare",
    category: "offense",
    modifiers: { explosionRadiusAdd: 40 },
  },
  {
    id: "lifesteal",
    name: "Life Steal",
    description: "Heal 20% of damage dealt",
    rarity: "rare",
    category: "offense",
    modifiers: { lifeStealAdd: 0.2 },
  },
  {
    id: "knockback",
    name: "Knockback",
    description: "+100% knockback force",
    rarity: "common",
    category: "offense",
    modifiers: { knockbackForceMult: 2.0 },
  },
  {
    id: "fast_bullets",
    name: "Fast Bullets",
    description: "+50% bullet speed",
    rarity: "common",
    category: "offense",
    modifiers: { bulletSpeedMult: 1.5 },
  },
  {
    id: "extra_ammo",
    name: "Extra Ammo",
    description: "+4 ammo capacity",
    rarity: "common",
    category: "offense",
    modifiers: { ammoCapacityAdd: 4 },
  },

  // =========== DEFENSE CARDS ===========
  {
    id: "health_up",
    name: "Health Up",
    description: "+50% max health",
    rarity: "common",
    category: "defense",
    modifiers: { maxHealthMult: 1.5 },
  },
  {
    id: "thick_skin",
    name: "Thick Skin",
    description: "+100% max health, -15% move speed",
    rarity: "uncommon",
    category: "defense",
    modifiers: { maxHealthMult: 2.0, moveSpeedMult: 0.85 },
  },
  {
    id: "shield",
    name: "Shield",
    description: "+50 shield (absorbs damage first)",
    rarity: "uncommon",
    category: "defense",
    modifiers: { shieldHealthAdd: 50 },
  },
  {
    id: "quick_reload",
    name: "Quick Reload",
    description: "-40% reload time",
    rarity: "common",
    category: "defense",
    modifiers: { reloadTimeMult: 0.6 },
  },

  // =========== MOBILITY CARDS ===========
  {
    id: "speed_up",
    name: "Speed Up",
    description: "+30% movement speed",
    rarity: "common",
    category: "mobility",
    modifiers: { moveSpeedMult: 1.3 },
  },
  {
    id: "jump_up",
    name: "Jump Up",
    description: "+40% jump height",
    rarity: "common",
    category: "mobility",
    modifiers: { jumpForceMult: 1.4 },
  },
  {
    id: "double_jump",
    name: "Double Jump",
    description: "+1 extra jump",
    rarity: "uncommon",
    category: "mobility",
    modifiers: { extraJumpsAdd: 1 },
  },
  {
    id: "triple_jump",
    name: "Triple Jump",
    description: "+2 extra jumps, -20% jump force",
    rarity: "rare",
    category: "mobility",
    modifiers: { extraJumpsAdd: 2, jumpForceMult: 0.8 },
    incompatibleWith: ["double_jump"],
  },
  {
    id: "dash",
    name: "Dash",
    description: "Gain 1 dash ability",
    rarity: "uncommon",
    category: "mobility",
    modifiers: { dashCountAdd: 1 },
  },
  {
    id: "featherweight",
    name: "Featherweight",
    description: "-30% gravity, +20% move speed",
    rarity: "uncommon",
    category: "mobility",
    modifiers: { gravityMult: 0.7, moveSpeedMult: 1.2 },
  },

  // =========== SPECIAL CARDS ===========
  {
    id: "glass_cannon",
    name: "Glass Cannon",
    description: "+100% damage, -50% max health",
    rarity: "rare",
    category: "special",
    modifiers: { damageMult: 2.0, maxHealthMult: 0.5 },
  },
  {
    id: "tank",
    name: "Tank",
    description: "+150% health, -30% speed, -20% damage",
    rarity: "rare",
    category: "special",
    modifiers: { maxHealthMult: 2.5, moveSpeedMult: 0.7, damageMult: 0.8 },
  },
  {
    id: "spray_and_pray",
    name: "Spray and Pray",
    description: "+4 bullets, +60% fire rate, +30° spread, -60% damage",
    rarity: "rare",
    category: "special",
    modifiers: {
      bulletCountAdd: 4,
      fireRateMult: 1.6,
      bulletSpreadAdd: 30,
      damageMult: 0.4,
    },
  },
  {
    id: "sniper",
    name: "Sniper",
    description: "+100% damage, +100% bullet speed, -50% fire rate",
    rarity: "rare",
    category: "special",
    modifiers: {
      damageMult: 2.0,
      bulletSpeedMult: 2.0,
      fireRateMult: 0.5,
    },
  },
];

// =============================================================================
// Card Selection
// =============================================================================

/**
 * Rarity weights for card selection.
 * Higher weight = more likely to appear.
 */
const RARITY_WEIGHTS: Record<CardRarity, number> = {
  common: 60,
  uncommon: 30,
  rare: 10,
};

/**
 * Get a card by ID
 */
export function getCard(cardId: string): Card | undefined {
  return CARDS.find((c) => c.id === cardId);
}

/**
 * Get all cards of a specific rarity
 */
export function getCardsByRarity(rarity: CardRarity): Card[] {
  return CARDS.filter((c) => c.rarity === rarity);
}

/**
 * Get cards that are compatible with the player's current cards
 */
export function getCompatibleCards(currentCards: string[]): Card[] {
  return CARDS.filter((card) => {
    // Already has this card? Some cards can stack, but for simplicity we disallow duplicates
    if (currentCards.includes(card.id)) return false;

    // Check incompatibility
    if (card.incompatibleWith) {
      for (const incompatible of card.incompatibleWith) {
        if (currentCards.includes(incompatible)) return false;
      }
    }

    // Check if any current card is incompatible with this one
    for (const currentCardId of currentCards) {
      const currentCard = getCard(currentCardId);
      if (currentCard?.incompatibleWith?.includes(card.id)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Select a random card based on rarity weights.
 * Uses a seeded approach for determinism.
 *
 * @param availableCards Cards to choose from
 * @param seed Seed for deterministic selection
 * @returns Selected card
 */
export function selectRandomCard(availableCards: Card[], seed: number): Card {
  if (availableCards.length === 0) {
    throw new Error("No available cards to select from");
  }

  // Group by rarity
  const byRarity: Record<CardRarity, Card[]> = {
    common: [],
    uncommon: [],
    rare: [],
  };

  for (const card of availableCards) {
    byRarity[card.rarity].push(card);
  }

  // Calculate total weight
  let totalWeight = 0;
  for (const rarity of Object.keys(byRarity) as CardRarity[]) {
    if (byRarity[rarity].length > 0) {
      totalWeight += RARITY_WEIGHTS[rarity];
    }
  }

  // Deterministic random using seed
  const random = deterministicRandom(seed);
  let roll = random * totalWeight;

  // Select rarity
  let selectedRarity: CardRarity = "common";
  for (const rarity of Object.keys(byRarity) as CardRarity[]) {
    if (byRarity[rarity].length > 0) {
      roll -= RARITY_WEIGHTS[rarity];
      if (roll <= 0) {
        selectedRarity = rarity;
        break;
      }
    }
  }

  // Select card within rarity
  const cards = byRarity[selectedRarity];
  const cardIndex = Math.floor(deterministicRandom(seed + 1) * cards.length);
  return cards[cardIndex] ?? availableCards[0] as Card;
}

/**
 * Generate 3 card options for the card pick phase.
 *
 * @param currentCards Player's current cards
 * @param seed Seed for deterministic generation
 * @returns Array of 3 cards
 */
export function generateCardOptions(
  currentCards: string[],
  seed: number,
): [Card, Card, Card] {
  const compatible = getCompatibleCards(currentCards);

  // If not enough compatible cards, just use what we have
  if (compatible.length < 3) {
    // Pad with first cards if needed
    while (compatible.length < 3) {
      compatible.push(CARDS[compatible.length % CARDS.length] as Card);
    }
  }

  const options: Card[] = [];
  const used = new Set<string>();

  for (let i = 0; i < 3; i++) {
    // Filter out already selected
    const available = compatible.filter((c) => !used.has(c.id));
    if (available.length === 0) break;

    const card = selectRandomCard(available, seed + i * 100);
    options.push(card);
    used.add(card.id);
  }

  // Safety: ensure we have exactly 3
  while (options.length < 3) {
    options.push(CARDS[options.length] as Card);
  }

  return options as [Card, Card, Card];
}

// =============================================================================
// Stat Computation
// =============================================================================

/**
 * Apply a card's modifiers to stats.
 * Multipliers are multiplicative, additions are additive.
 */
export function applyCardModifiers(
  stats: PlayerStats,
  modifiers: CardStatModifiers,
): PlayerStats {
  return {
    maxHealth: Math.round(stats.maxHealth * (modifiers.maxHealthMult ?? 1)),
    moveSpeed: stats.moveSpeed * (modifiers.moveSpeedMult ?? 1),
    jumpForce: stats.jumpForce * (modifiers.jumpForceMult ?? 1),
    damage: stats.damage * (modifiers.damageMult ?? 1),
    fireRate: stats.fireRate * (modifiers.fireRateMult ?? 1),
    bulletSpeed: stats.bulletSpeed * (modifiers.bulletSpeedMult ?? 1),
    bulletCount: stats.bulletCount + (modifiers.bulletCountAdd ?? 0),
    bulletSpread: stats.bulletSpread + (modifiers.bulletSpreadAdd ?? 0),
    bulletBounces: stats.bulletBounces + (modifiers.bulletBouncesAdd ?? 0),
    bulletSize: stats.bulletSize * (modifiers.bulletSizeMult ?? 1),
    reloadTime: stats.reloadTime * (modifiers.reloadTimeMult ?? 1),
    ammoCapacity: stats.ammoCapacity + (modifiers.ammoCapacityAdd ?? 0),
    extraJumps: stats.extraJumps + (modifiers.extraJumpsAdd ?? 0),
    dashCount: stats.dashCount + (modifiers.dashCountAdd ?? 0),
    shieldHealth: stats.shieldHealth + (modifiers.shieldHealthAdd ?? 0),
    lifeSteal: stats.lifeSteal + (modifiers.lifeStealAdd ?? 0),
    explosionRadius: stats.explosionRadius + (modifiers.explosionRadiusAdd ?? 0),
    knockbackForce: stats.knockbackForce * (modifiers.knockbackForceMult ?? 1),
    gravity: stats.gravity * (modifiers.gravityMult ?? 1),
  };
}

/**
 * Compute final player stats from base stats and all cards.
 */
export function computePlayerStats(cards: string[]): PlayerStats {
  let stats = { ...DEFAULT_PLAYER_STATS };

  for (const cardId of cards) {
    const card = getCard(cardId);
    if (card) {
      stats = applyCardModifiers(stats, card.modifiers);
    }
  }

  return stats;
}

// =============================================================================
// Utility
// =============================================================================

/**
 * Simple deterministic random number generator.
 * Returns a number between 0 and 1.
 */
function deterministicRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
