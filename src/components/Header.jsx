import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';

const Header = ({ isAuthenticated, setIsAuthenticated, user }) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const navigate = useNavigate();
  
  // User display name
  const userDisplayName = user 
    ? (user.user_metadata?.full_name || user.email || fr.profile)
    : fr.profile;

  const handleSignIn = async (provider) => {
    try {
      console.log('OAuth redirectTo:', window.location.origin);
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin
        }
      });
      
      if (error) {
        console.error(`${fr.authError}:`, error);
      }
    } catch (error) {
      console.error(`${fr.authError}:`, error);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error(`${fr.authError}:`, error);
      } else {
        setIsAuthenticated(false);
        setIsDropdownOpen(false);
        navigate('/');
      }
    } catch (error) {
      console.error(`${fr.authError}:`, error);
    }
  };

  return (
    <header className="bg-blue-600 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <h1 
          className="text-2xl font-bold cursor-pointer"
          onClick={() => navigate('/')}
        >
          {fr.appTitle}
        </h1>
        
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg"
          >
            {isAuthenticated ? userDisplayName : fr.signIn}
          </button>
          
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white text-gray-800 rounded-lg shadow-lg py-2 z-50">
              {!isAuthenticated ? (
                <>
                  <button
                    onClick={() => handleSignIn('google')}
                    className="w-full px-4 py-3 text-left hover:bg-gray-100"
                  >
                    {fr.signInWithGoogle}
                  </button>
                  <button
                    onClick={() => handleSignIn('facebook')}
                    className="w-full px-4 py-3 text-left hover:bg-gray-100"
                  >
                    {fr.signInWithFacebook}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleSignOut}
                    className="w-full px-4 py-3 text-left hover:bg-gray-100 text-red-600"
                  >
                    {fr.signOut}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;