function formatDateTime(value) {
  if (!value) return '기록 없음'

  const text = String(value)
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const normalized = text.includes('T') && !hasExplicitTimezone ? `${text}Z` : value

  return new Date(normalized).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  })
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-'
}

function formatProjectedScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString()}점` : '예측 대기'
}

function getCapacityText(stats) {
  if (stats.availableSlots > 0) return `${stats.availableSlots}자리 남음`
  if (stats.availableSlots === 0) return '만원'
  return '정원 초과'
}

function getStatusText(status) {
  if (status === 'loading') return '불러오는 중'
  if (status === 'success') return '최신'
  if (status === 'empty') return '데이터 없음'
  if (status === 'error') return '오류'
  return '대기'
}

function StatusBadge({ children }) {
  if (!children) return null
  return <span className="status-badge">{children}</span>
}

function SummaryList({ emptyText, items, renderItem, title }) {
  return (
    <div className="staff-summary-block">
      <span>{title}</span>
      {items.length === 0 ? (
        <p className="summary-empty">{emptyText}</p>
      ) : (
        <ul className="staff-mini-list full-list">
          {items.map((item) => (
            <li key={`${title}-${item.nickname}`} className="staff-mini-item">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GuildSummaryCard({ guild, stats, summary }) {
  const statusText = getStatusText(guild.apiState?.status)

  return (
    <article className="guild-summary-card selected-guild-card">
      <div className="guild-card-head simple-head">
        <div>
          <span>{guild.seasonPeriod}</span>
          <h2>{guild.guildName}</h2>
        </div>
        <StatusBadge>{statusText}</StatusBadge>
      </div>

      <div className="guild-card-metrics staff-metrics">
        <div>
          <span>기준점수</span>
          <strong>{stats.cutScore.toLocaleString()}</strong>
        </div>
        <div>
          <span>총원</span>
          <strong>{stats.memberCount}명</strong>
        </div>
        <div>
          <span>정원</span>
          <strong>{stats.memberCount}/{stats.maxMembers}</strong>
          <small>{getCapacityText(stats)}</small>
        </div>
        <div>
          <span>미달</span>
          <strong>{stats.warningCount}명</strong>
        </div>
        <div>
          <span>미활동<br />6시간+</span>
          <strong>{stats.inactiveSixHourCount}명</strong>
        </div>
        <div>
          <span>미참여</span>
          <strong>{stats.seasonNotJoinedCount}명</strong>
        </div>
        <div>
          <span>기록 불가</span>
          <strong>{stats.unverifiedCount}명</strong>
        </div>
        <div>
          <span>닉네임 확인</span>
          <strong>{stats.nicknameWarningCount}명</strong>
        </div>
        <div>
          <span>이동 후보</span>
          <strong>{stats.moveCandidateCount}명</strong>
        </div>
        <div>
          <span>달성률</span>
          <strong>{stats.achievementRate}%</strong>
        </div>
      </div>

      <div className="last-refresh-line">마지막 갱신: {formatDateTime(guild.lastRefreshedAt)}</div>

      <div className="staff-summary-list">
        <SummaryList
          emptyText="미달자 없음"
          items={summary.shortageMembers}
          title="미달자 전체"
          renderItem={(member) => (
            <>
              <strong>{member.nickname}</strong>
              <span>현재 점수: {member.score.toLocaleString()}점</span>
              <em>
                기준 {(member.effectiveCutScore ?? guild.cutScore).toLocaleString()} · {member.shortage.toLocaleString()} 부족
              </em>
              {member.isProratedCut && (
                <em>시즌 중 신규 관측 · 기본컷 {guild.cutScore.toLocaleString()}</em>
              )}
              <em>마지막 기록: {formatDateTime(member.lastRecord)}</em>
            </>
          )}
        />
        <SummaryList
          emptyText="6시간 이상 미활동 없음"
          items={summary.inactiveMembers}
          title="6시간 이상 미활동"
          renderItem={(member) => (
            <>
              <strong>{member.nickname}</strong>
              <span>{member.score.toLocaleString()}점 · wave {typeof member.wph?.wave === 'number' ? member.wph.wave.toLocaleString() : '-'}</span>
              <em>마지막 기록: {formatDateTime(member.lastRecord)}</em>
              <em>미활동: {member.inactiveText}</em>
            </>
          )}
        />
        <SummaryList
          emptyText="기록 확인 불가 없음"
          items={summary.unverifiedMembers}
          title="기록 확인 불가"
          renderItem={(member) => (
            <>
              <div className="member-title-row">
                <strong>{member.nickname}</strong>
                <StatusBadge>기록 확인 불가</StatusBadge>
              </div>
              <span>{member.score.toLocaleString()}점</span>
              <em>{member.wph?.errorMessage || '상세 불러오기 실패'}</em>
            </>
          )}
        />
        <SummaryList
          emptyText="닉네임 양식 확인 대상 없음"
          items={summary.nicknameWarningMembers}
          title="닉네임 양식 확인"
          renderItem={(member) => (
            <>
              <strong>{member.nickname}</strong>
              <span>현재 점수: {member.score.toLocaleString()}점</span>
              <em>권장 양식: SL_ 로 시작</em>
            </>
          )}
        />
        <SummaryList
          emptyText="이동 후보 없음"
          items={summary.moveCandidates}
          title="이동 후보 전체"
          renderItem={(member) => (
            <>
              <strong>{member.nickname}</strong>
              <span>{member.currentGuild} → {member.recommendedGuild}</span>
              <em>현재 점수: {formatNumber(member.currentScore)}점</em>
              <em>예상 종료: {formatProjectedScore(member.projectedFinalScore)} · {member.projectionBasis}</em>
            </>
          )}
        />
      </div>
    </article>
  )
}

export default GuildSummaryCard
