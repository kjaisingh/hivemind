import bcrypt from 'bcryptjs';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { SupabaseStore } from './sessionStore.js';
import { unwrap } from './db.js';

export function createSessionMiddleware() {
  return session({
    store: new SupabaseStore(),
    secret: process.env.SESSION_SECRET || 'hivemind-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
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

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(null, false, { message: 'Google account has no email.' });
            }

            let user = unwrap(await supabase.from('User').select('*').eq('googleId', profile.id).maybeSingle());
            if (!user) {
              user = unwrap(await supabase.from('User').select('*').eq('email', email).maybeSingle());
            }

            if (!user) {
              const base = profile.displayName
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .slice(0, 14);
              const username = `${base}${Math.floor(Math.random() * 900 + 100)}`;

              user = unwrap(
                await supabase
                  .from('User')
                  .insert({ email, username, googleId: profile.id })
                  .select()
                  .single(),
              );
            } else if (!user.googleId) {
              user = unwrap(
                await supabase.from('User').update({ googleId: profile.id }).eq('id', user.id).select().single(),
              );
            }

            return done(null, user);
          } catch (error) {
            return done(error);
          }
        },
      ),
    );
  }

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
