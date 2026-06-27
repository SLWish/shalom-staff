const paths = {
  chart: 'M4 19V9m8 10V5m8 14v-7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  rank: 'M5 19h14M7 15l3-3 3 2 4-6',
  alert: 'M12 4 3 20h18L12 4Zm0 6v4m0 3h.01',
  activity: 'M4 12h4l2-6 4 12 2-6h4',
  move: 'M5 12h13m-5-5 5 5-5 5',
  speed: 'M4 14a8 8 0 1 1 16 0M12 14l4-4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v3m0 12v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M3 12h3m12 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  status: 'M5 12l4 4L19 6',
}

function MenuIcon({ name }) {
  return (
    <svg className="menu-icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

export default MenuIcon
