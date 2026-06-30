export const guildConfigs = [
  {
    guildName: 'ShaLom',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom',
    defaultCutScore: 40000,
    order: 1,
    type: 'active',
  },
  {
    guildName: 'ShaLom2',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom2',
    defaultCutScore: 15000,
    order: 2,
    type: 'active',
  },
  {
    guildName: 'ShaLom3',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom3',
    defaultCutScore: 7000,
    order: 3,
    type: 'active',
  },
  {
    guildName: 'ShaLom4',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom4',
    defaultCutScore: 3000,
    order: 4,
    type: 'active',
  },
  {
    guildName: 'ShaLom5',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom5',
    defaultCutScore: 0,
    order: 5,
    type: 'rest',
  },
  {
    guildName: 'ShaLom6',
    apiUrl: 'https://raongames.com/growcastle/restapi/season/now/guilds/ShaLom6',
    defaultCutScore: 0,
    order: 6,
    type: 'rest',
  },
]

export const activeGuildConfigs = guildConfigs.filter((config) => config.type === 'active')
export const restGuildConfigs = guildConfigs.filter((config) => config.type === 'rest')

export const menuItems = [
  { id: 'status', label: '길드 현황', icon: 'status' },
  { id: 'new-members', label: '신규 확인', icon: 'alert' },
  { id: 'members', label: '전체 인원', icon: 'status' },
  { id: 'attention', label: '시즌 기록', icon: 'alert' },
  { id: 'wph', label: 'WPH', icon: 'status' },

  { id: 'moves', label: '이동 후보', icon: 'move' },
]
