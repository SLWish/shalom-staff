function StatCard({ accent, label, tone, value }) {
  const classes = ['stat-card', accent ? `accent-${accent}` : '', tone ? `tone-${tone}` : '']
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classes}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

export default StatCard
