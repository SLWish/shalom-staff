function PageShell({ children, eyebrow, title }) {
  return (
    <section className="page-shell">
      <div className="page-heading">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {children}
    </section>
  )
}

export default PageShell
