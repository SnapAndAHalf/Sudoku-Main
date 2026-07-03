/* Power pool. Each game draws 3 of these 6 (seeded per game).
   Costs are tuned so a clean game earns ~800–1200 pts → 3-5 power uses max. */
const POWERS = [
  {
    id: 'oracle',
    name: 'Reveal',
    icon: '🔮',
    cost: 150,
    desc: 'Fills the selected empty cell with the correct number (random cell if none selected).',
  },
  {
    id: 'secondwind',
    name: 'Second Wind',
    icon: '💗',
    cost: 200,
    desc: 'Restores one lost heart.',
  },
  {
    id: 'freeze',
    name: 'Time Freeze',
    icon: '❄️',
    cost: 100,
    desc: 'Freezes the timer for 45 seconds — mistakes still count!',
  },
  {
    id: 'autonotes',
    name: 'Auto Notes',
    icon: '📝',
    cost: 180,
    desc: 'Fills accurate pencil notes into every empty cell.',
  },
  {
    id: 'shield',
    name: 'Shield',
    icon: '🛡️',
    cost: 120,
    desc: 'Your next mistake costs no heart.',
  },
  {
    id: 'beacon',
    name: 'Beacon',
    icon: '🔦',
    cost: 80,
    desc: 'Highlights every legal spot for the selected number for 8 seconds.',
  },
];

/* Fixed set of 3 powers for the game (Reveal, Shield, Beacon). */
function drawPowers(seedStr) {
  return [
    POWERS.find(p => p.id === 'oracle'),
    POWERS.find(p => p.id === 'shield'),
    POWERS.find(p => p.id === 'beacon'),
  ];
}
