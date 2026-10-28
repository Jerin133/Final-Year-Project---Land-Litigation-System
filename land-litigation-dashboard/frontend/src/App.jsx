import { Routes, Route, Navigate } from 'react-router-dom'
import { supabaseConfigured } from './lib/supabase.js'
import Navbar from './components/Navbar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import CitizenDashboard from './pages/citizen/CitizenDashboard.jsx'
import GovDashboard from './pages/gov/GovDashboard.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="center-card">
        <div className="card">
          <h2>Supabase is not configured</h2>
          <p>Copy <code>frontend/.env.example</code> to <code>frontend/.env</code>, fill in
            <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart
            <code> npm run dev</code>.</p>
        </div>
      </div>
    )
  }
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/citizen" element={<ProtectedRoute role="citizen"><CitizenDashboard /></ProtectedRoute>} />
        <Route path="/government" element={<ProtectedRoute role="government"><GovDashboard /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
