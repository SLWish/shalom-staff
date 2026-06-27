function CutScorePanel({ cutScore, defaultCutScore, guildName, onChange, onReset }) {
  return (
    <section className="cut-score-panel">
      <label>
        <span>{guildName} 기준점수</span>
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={cutScore}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
        />
      </label>
      <button type="button" onClick={onReset}>
        기본값으로 초기화 ({defaultCutScore.toLocaleString()})
      </button>
    </section>
  )
}

export default CutScorePanel
