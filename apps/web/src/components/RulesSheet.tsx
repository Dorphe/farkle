import { useEffect, useRef } from "react";
import {
  detectPreset,
  preset,
  type GameConfig,
  type PresetName,
} from "@farkle/engine";

const PRESET_LABELS: Record<PresetName | "custom", string> = {
  classic: "Classic",
  bar: "Bar",
  family: "Family",
  custom: "Custom",
};

function Segmented<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="rule-section">
      <span className="rule-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="seg"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rule-row">
      <span className="rule-label">{label}</span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" aria-hidden="true" />
        <span>{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

export function RulesSheet({
  config,
  onChange,
  onClose,
}: {
  config: GameConfig;
  onChange: (config: GameConfig) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const presetName = detectPreset(config);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (patch: Partial<GameConfig>) => onChange({ ...config, ...patch });
  const applyPreset = (name: PresetName) =>
    onChange({ ...preset(name), firstPlayer: config.firstPlayer });

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet rules-sheet" role="dialog" aria-modal="true" aria-labelledby="rules-sheet-title">
        <div className="sheet-head">
          <div>
            <h2 id="rules-sheet-title">House rules</h2>
            <p className="sheet-sub">{PRESET_LABELS[presetName]} · {config.target.toLocaleString("en-US")} to win</p>
          </div>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Close house rules">
            ×
          </button>
        </div>

        <div className="preset-row" role="group" aria-label="Rule preset">
          {(["classic", "bar", "family"] as const).map((name) => (
            <button
              key={name}
              type="button"
              className="chip"
              aria-pressed={presetName === name}
              onClick={() => applyPreset(name)}
            >
              {PRESET_LABELS[name]}
            </button>
          ))}
          {presetName === "custom" ? <span className="chip is-static">Custom</span> : null}
        </div>

        <div className="rule-card">
          <div className="rule-section">
            <div className="rule-section-head">
              <span className="rule-label">Target score</span>
              <span className="rule-value">{config.target.toLocaleString("en-US")}</span>
            </div>
            <div className="segmented">
              {[5_000, 10_000, 15_000].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="seg"
                  aria-pressed={config.target === value}
                  onClick={() => update({ target: value })}
                >
                  {value.toLocaleString("en-US")}
                </button>
              ))}
              <input
                type="text"
                inputMode="numeric"
                className="num-input"
                aria-label="Custom target score"
                value={config.target ? config.target.toLocaleString("en-US") : ""}
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^\d]/g, "");
                  update({ target: digits ? Number(digits) : 0 });
                }}
                onBlur={() => update({ target: Math.min(50_000, Math.max(1_000, config.target || 10_000)) })}
              />
            </div>
          </div>
          <Segmented
            label="Entry threshold"
            value={config.entryThreshold}
            options={[
              { value: 0, label: "Off" },
              { value: 500, label: "500" },
              { value: 1_000, label: "1,000" },
            ]}
            onChange={(value) => update({ entryThreshold: value })}
          />
          <Segmented
            label="Straight 1–6"
            value={config.straight}
            options={[
              { value: null, label: "Off" },
              { value: 1_000, label: "1,000" },
              { value: 1_500, label: "1,500" },
              { value: 3_000, label: "3,000" },
            ]}
            onChange={(value) => update({ straight: value })}
          />
          <ToggleRow
            label="Three pairs (1,500)"
            checked={config.threePairs}
            onChange={(checked) => update({ threePairs: checked })}
          />
          <ToggleRow
            label="Two triplets (2,500)"
            checked={config.twoTriplets}
            onChange={(checked) => update({ twoTriplets: checked })}
          />
          <ToggleRow
            label="Hot dice"
            checked={config.hotDice}
            onChange={(checked) => update({ hotDice: checked })}
          />
          <ToggleRow
            label="Farkle penalty (−1,000)"
            checked={config.farklePenalty > 0}
            onChange={(checked) => update({ farklePenalty: checked ? 1_000 : 0 })}
          />
          <Segmented
            label="Win condition"
            value={config.winCondition}
            options={[
              { value: "first", label: "First to target" },
              { value: "completeRound", label: "Complete round" },
            ]}
            onChange={(value) => update({ winCondition: value })}
          />
          <Segmented
            label="First player"
            value={config.firstPlayer}
            options={[
              { value: "first", label: "Player 1" },
              { value: "random", label: "Random" },
            ]}
            onChange={(value) => update({ firstPlayer: value })}
          />
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
