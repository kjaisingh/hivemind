import session from 'express-session';
import { supabase } from './db.js';

export class SupabaseStore extends session.Store {
  async get(sid, callback) {
    try {
      const { data, error } = await supabase
        .from('Session')
        .select('sess, expiresAt')
        .eq('sid', sid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || new Date(data.expiresAt) < new Date()) {
        return callback(null, null);
      }
      callback(null, data.sess);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 1000 * 60 * 60 * 24;
      const expiresAt = new Date(Date.now() + maxAge).toISOString();
      const { error } = await supabase.from('Session').upsert({ sid, sess, expiresAt }, { onConflict: 'sid' });
      if (error) throw new Error(error.message);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      const { error } = await supabase.from('Session').delete().eq('sid', sid);
      if (error) throw new Error(error.message);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 1000 * 60 * 60 * 24;
      const expiresAt = new Date(Date.now() + maxAge).toISOString();
      const { error } = await supabase.from('Session').update({ expiresAt }).eq('sid', sid);
      if (error) throw new Error(error.message);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}
