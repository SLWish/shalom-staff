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

function RankingTable({ cutScore, members }) {
  return (
    <div className="table-wrap">
      <table className="ranking-table score-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>닉네임</th>
            <th>현재 점수</th>
            <th>기준점수</th>
            <th>달성</th>
            <th>증가</th>
            <th>상태</th>
            <th>wave</th>
            <th>기록 시각</th>
            <th>15분 wave</th>
            <th>15분 WPH</th>
            <th>score 증가</th>
            <th>WPH 상태</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => (
            <tr key={member.nickname}>
              <td data-label="순위">
                <span className="table-rank">{index + 1}</span>
              </td>
              <td data-label="닉네임">{member.nickname}</td>
              <td data-label="현재 점수">{member.score.toLocaleString()}</td>
              <td data-label="기준점수">{cutScore.toLocaleString()}</td>
              <td data-label="달성">
                <span className={member.score >= cutScore ? 'status-pill success' : 'status-pill danger'}>
                  {member.score >= cutScore ? '달성' : '미달'}
                </span>
              </td>
              <td data-label="증가">{formatIncrease(member.history.increasedBy)}</td>
              <td data-label="상태">
                <span className={`status-pill ${member.history.status === 'Defeat 의심' ? 'danger' : 'neutral'}`}>
                  {formatStatus(member.history.status)}
                </span>
              </td>
              <td data-label="wave">{formatOptionalNumber(member.wph.wave)}</td>
              <td data-label="기록 시각">{formatKst(member.wph.apiDate)}</td>
              <td data-label="15분 wave">{formatOptionalNumber(member.wph.waveDelta)}</td>
              <td data-label="15분 WPH">{formatOptionalNumber(member.wph.wph)}</td>
              <td data-label="score 증가">{formatOptionalNumber(member.wph.scoreDelta)}</td>
              <td data-label="WPH 상태">{member.wph.wphStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default RankingTable
