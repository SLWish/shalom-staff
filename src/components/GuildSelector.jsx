function GuildSelector({ guilds, selectedGuildName, onChange }) {
  return (
    <section className="guild-tabs" aria-label="길드 선택">
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
