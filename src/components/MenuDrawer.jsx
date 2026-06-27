import MenuIcon from './MenuIcon.jsx'

function MenuDrawer({ activePage, isOpen, items, onSelect }) {
  return (
    <nav className={`menu-drawer ${isOpen ? 'open' : ''}`} aria-label="메인 메뉴">
      <div className="drawer-title">
        <strong>ShaLom Info</strong>
        <span>스탭 관리 메뉴</span>
      </div>
      <div className="drawer-menu">
        {items.map((item) => (
          <button
            type="button"
            className={activePage === item.id ? 'active' : ''}
            key={item.id}
            onClick={() => onSelect(item.id)}
          >
            <MenuIcon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

export default MenuDrawer
