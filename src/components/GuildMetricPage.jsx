import { useState } from 'react'
import PageShell from './PageShell.jsx'

const titles = {
  cut: '기준점수', members: '총원', capacity: '정원', shortage: '미달',
  inactive: '6시간 이상 미활동', notJoined: '미참여', details: '개인 상세 확인',
  new: '신규 확인', nickname: '닉네임 확인', achievement: '달성률',
}

export default function GuildMetricPage({ entry, metric, onBack, onLoadDetails }) {
  const [loading, setLoading] = useState(false)
  const { guild, stats, staffData } = entry
  const groups = {
    shortage: staffData.shortageMembers,
    inactive: staffData.inactiveMembers,
    notJoined: staffData.seasonNotJoinedMembers,
    details: [...staffData.unverifiedMembers, ...staffData.detailPendingMembers],
    new: staffData.newMembers,
    nickname: staffData.nicknameWarningMembers,
    achievement: guild.members.filter((member) => member.score >= (member.effectiveCutScore ?? guild.cutScore)),
  }
  const members = groups[metric] ?? guild.members
  const hiddenShortage = metric === 'shortage' && !staffData.showShortageMembers

  return (
    <PageShell eyebrow={guild.guildName} title={titles[metric]}>
      <button type="button" className="metric-back" onClick={onBack}>← 길드 현황으로</button>
      <section className="staff-section">
        <div className="section-title">
          <span>{guild.guildName} · {titles[metric]}</span>
          <h2>{metric === 'achievement' ? `${stats.achievementRate}% · 달성 ${members.length}명` : `${members.length}명`}</h2>
        </div>
        {(metric === 'cut' || metric === 'shortage' || metric === 'achievement') && (
          <p>기준점수 {stats.cutScore.toLocaleString()}점 · 시즌 중 신규 인원은 개인별 기준 적용</p>
        )}
        {metric === 'capacity' && <p>정원 {stats.memberCount}/{stats.maxMembers} · 남은 자리 {Math.max(0, stats.availableSlots)}개</p>}
        {metric === 'nickname' && <p>닉네임이 SL_ 형식인지 확인해주세요.</p>}
        {['details', 'inactive', 'notJoined'].includes(metric) && (
          <button type="button" className="metric-back" disabled={loading} onClick={async () => {
            setLoading(true)
            try { await onLoadDetails() } finally { setLoading(false) }
          }}>{loading ? '상세 확인 중…' : '개인 상세 기록 확인'}</button>
        )}
        {hiddenShortage ? <p className="summary-empty">미달자 목록은 시즌 마지막 날 공개됩니다.</p> : members.length === 0 ? (
          <p className="summary-empty">해당 인원이 없습니다.</p>
        ) : (
          <div className="staff-card-list compact-list">
            {members.map((member) => (
              <article className="staff-row-card" key={member.nickname}>
                <div className="member-title-row">
                  <strong>{member.nickname}</strong>
                  {member.isGuildLeader && <span className="role-badge">길드장</span>}
                </div>
                <p>현재 점수 {member.score.toLocaleString()}점</p>
                {['cut', 'shortage', 'achievement'].includes(metric) && <p>개인 기준 {(member.effectiveCutScore ?? guild.cutScore).toLocaleString()}점</p>}
                {metric === 'shortage' && <p>{member.shortage.toLocaleString()}점 부족</p>}
                {member.inactiveText && ['inactive', 'notJoined'].includes(metric) && <p>{member.inactiveText}</p>}
                {metric === 'details' && <p>{member.wph?.fetchStatus === 'error' ? member.wph.errorMessage || '기록 확인 불가' : '상세 미조회'}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  )
}
