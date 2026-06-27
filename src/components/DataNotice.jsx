function DataNotice({ state }) {
  if (!state?.message) {
    return null
  }

  return (
    <div className={`data-notice ${state.status || 'idle'}`}>
      <strong>{state.title}</strong>
      <span>{state.message}</span>
    </div>
  )
}

export default DataNotice
