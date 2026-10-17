// The browser may use a Supabase publishable key. Database grants and RLS
// policies limit this client to inserting contact and deletion requests.
(() => {
    const supabaseUrl = 'https://pgkehdchxfbxsswyqhac.supabase.co';
    const publishableKey = 'sb_publishable_QRXIBVha9PpuBOON52GdCw_E3tUrTuP';
    const cleanText = (value, maxLength) =>
        typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    async function insertRow(table, row) {
        const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                apikey: publishableKey,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(row)
        });

        if (response.ok) return;

        let details = {};
        try {
            details = await response.json();
        } catch {
            // Keep the HTTP status as the useful error when the body is empty.
        }

        const error = new Error(details.message || `Supabase returned HTTP ${response.status}.`);
        error.status = response.status;
        error.code = details.code;
        throw error;
    }

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

            try {
                await insertRow('contact_messages', submission);
                return { success: true };
            } catch (error) {
                console.error('Could not save contact message:', error);
                return { success: false, error };
            }
        },

        async saveDeletionRequest(accountEmail) {
            const email = cleanText(accountEmail, 254);
            if (!emailPattern.test(email)) {
                return { success: false, error: new Error('Please enter a valid account email.') };
            }

            try {
                await insertRow('account_deletion_requests', {
                    account_email: email,
                    confirmation: true
                });
                return { success: true };
            } catch (error) {
                console.error('Could not save account deletion request:', error);
                return { success: false, error };
            }
        }
    });
})();
