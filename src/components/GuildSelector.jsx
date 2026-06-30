function GuildSelector({ extraItems = [], guilds, selectedGuildName, onChange }) {
  return (
    <section className="guild-tabs" aria-label="길드 선택">
      {extraItems.map((item) => {
        const isActive = selectedGuildName === item.value

        return (
          <button
            type="button"
            className={isActive ? 'active' : ''}
            key={item.value}
            onClick={() => onChange(item.value)}
          >
            <span>{item.label}</span>
            <strong>{item.description}</strong>
          </button>
        )
      })}
      {guilds.map((guild) => {
        const isActive = selectedGuildName === guild.guildName

        return (
          <button
            type="button"
            className={isActive ? 'active' : ''}
            key={guild.guildName}
            onClick={() => onChange(guild.guildName)}
          >
            <span>{guild.guildName}</span>
            <strong>{guild.cutScore.toLocaleString()}</strong>
          </button>
        )
      })}
    </section>
  )
}

export default GuildSelector
