import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import CardGame40 from './CardGame40'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <CardGame40 />
    </>
  )
}

export default App
