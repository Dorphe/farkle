const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Pips({ face }: { face: number }) {
  const on = new Set(PIPS[face] ?? []);
  return (
    <span className="pips" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} className={on.has(index) ? "on" : ""} />
      ))}
    </span>
  );
}

export function DieButton({
  face,
  index,
  selected,
  onToggle,
  disabled = false,
}: {
  face: number;
  index: number;
  selected: boolean;
  onToggle: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="die"
      data-index={index}
      aria-pressed={selected}
      aria-label={`Die ${index + 1}, value ${face}${selected ? ", kept" : ""}`}
      onClick={() => onToggle(index)}
      disabled={disabled}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Pips face={face} />
    </button>
  );
}

export function GhostDice({ count }: { count: number }) {
  return (
    <div className="dice-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="die ghost" />
      ))}
    </div>
  );
}

export function MiniDie({ face }: { face: number }) {
  return (
    <span className="mini-die" aria-hidden="true">
      <Pips face={face} />
    </span>
  );
}
