import bcrypt from 'bcryptjs';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { SupabaseStore } from './sessionStore.js';
import { unwrap } from './db.js';

export function createSessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required.');
  }
  return session({
    store: new SupabaseStore(),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  });
}

export function configurePassport(supabase) {
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          const user = unwrap(await supabase.from('User').select('*').eq('email', email).maybeSingle());
          if (!user?.passwordHash) {
            return done(null, false, { message: 'Invalid credentials.' });
          }

          const valid = await bcrypt.compare(password, user.passwordHash);
          if (!valid) {
            return done(null, false, { message: 'Invalid credentials.' });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = unwrap(await supabase.from('User').select('*').eq('id', id).maybeSingle());
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}

export { passport };
