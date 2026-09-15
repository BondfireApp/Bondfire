import React from 'react'

const PublicEditContext = React.createContext({
  isEditing: false,
  setIsEditing: () => {},
})

export function PublicEditProvider({ children }) {
  const [isEditing, setIsEditing] = React.useState(false)
  return (
    <PublicEditContext.Provider value={{ isEditing, setIsEditing }}>
      {children}
    </PublicEditContext.Provider>
  )
}

export function usePublicEdit() {
  return React.useContext(PublicEditContext)
}
