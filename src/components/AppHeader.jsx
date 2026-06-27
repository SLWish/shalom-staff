function AppHeader({ isMenuOpen, onLogoClick, onMenuToggle }) {
  return (
    <header className="app-header">
      <button
        type="button"
        className="menu-toggle"
        aria-label={isMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
        aria-expanded={isMenuOpen}
        onClick={onMenuToggle}
      >
        <span />
        <span />
        <span />
      </button>
      <button type="button" className="logo-button" onClick={onLogoClick}>
        ShaLom
      </button>
      <div className="header-spacer" />
    </header>
  )
}

export default AppHeader
