function formatIncrease(value) {
  if (value > 0) {
    return `+${value.toLocaleString()}`
  }

  return value.toLocaleString()
}

function formatStatus(status) {
  return status === 'Defeat 의심' ? 'Defeat 의심 (확정 아님)' : status
}

function formatKst(value) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatOptionalNumber(value) {
  return typeof value === 'number' ? value.toLocaleString() : '-'
}

function WarningList({ guildName, members, target }) {
  return (
    <section className="warning-list">
      <article className="warning-group">
        <div className="warning-group-head">
          <div>
            <span>기준 {target.toLocaleString()}점</span>
            <strong>{guildName}</strong>
          </div>
          <p>{members.length}명</p>
        </div>
        {members.length === 0 ? (
          <div className="empty-state">전원 기준 달성</div>
        ) : (
          members.map((member) => (
            <div className="warning-card" key={member.nickname}>
              <div>
                <strong>{member.nickname}</strong>
                <span>현재 시즌 점수 {member.score.toLocaleString()}점</span>
              </div>
              <div className="warning-card-score">
                <span>기준 {target.toLocaleString()}점</span>
                <p>{(target - member.score).toLocaleString()}점 부족</p>
                <small>증가 {formatIncrease(member.history.increasedBy)} · {formatStatus(member.history.status)}</small>
                <small>
                  wave {formatOptionalNumber(member.wph.wave)} · 15분 WPH {formatOptionalNumber(member.wph.wph)}
                </small>
                <small>
                  score 증가 {formatOptionalNumber(member.wph.scoreDelta)} · {member.wph.wphStatus}
                </small>
                <small>API 기록 {formatKst(member.wph.apiDate)}</small>
              </div>
            </div>
          ))
        )}
      </article>
    </section>
  )
}

export default WarningList
