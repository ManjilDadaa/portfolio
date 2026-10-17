// The browser may use a Supabase publishable key. Row-level security and
// column-level grants in the StudentOS migration limit this client to inserts.
(() => {
    const supabaseLibrary = window.supabase;
    if (!supabaseLibrary?.createClient) {
        console.error('Supabase JavaScript client did not load.');
        window.supabaseService = null;
        return;
    }

    const client = supabaseLibrary.createClient(
        'https://pgkehdchxfbxsswyqhac.supabase.co',
        'sb_publishable_QRXIBVha9PpuBOON52GdCw_E3tUrTuP',
        {
            auth: {
                autoRefreshToken: false,
                detectSessionInUrl: false,
                persistSession: false
            }
        }
    );

    const cleanText = (value, maxLength) =>
        typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    window.supabaseService = Object.freeze({
        async saveContact({ name, email, message } = {}) {
            const submission = {
                name: cleanText(name, 100),
                email: cleanText(email, 254),
                message: cleanText(message, 5000)
            };

            if (!submission.name || !emailPattern.test(submission.email) || !submission.message) {
                return { success: false, error: new Error('Please check the contact form fields.') };
            }

            const { error } = await client.from('contact_messages').insert(submission);
            if (error) {
                console.error('Could not save contact message:', error);
                return { success: false, error };
            }
            return { success: true };
        },

        async saveDeletionRequest(accountEmail) {
            const email = cleanText(accountEmail, 254);
            if (!emailPattern.test(email)) {
                return { success: false, error: new Error('Please enter a valid account email.') };
            }

            const { error } = await client.from('account_deletion_requests').insert({
                account_email: email,
                confirmation: true
            });
            if (error) {
                console.error('Could not save account deletion request:', error);
                return { success: false, error };
            }
            return { success: true };
        }
    });
})();
