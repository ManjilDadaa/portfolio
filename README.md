# Manjil Basnet - Portfolio Website

A modern, responsive portfolio website with interactive Python quiz functionality.

## Features

- **Responsive Design**: Works on all devices
- **Interactive Quiz System**: Python learning quizzes with progress tracking
- **Secure Implementation**: Input sanitization and XSS protection
- **Performance Optimized**: Lazy loading and efficient DOM manipulation
- **Supabase Integration**: Separate tables for contact messages and StudentOS deletion requests
- **Private quiz progress**: Progress is saved locally in the visitor's browser
- **StudentOS support pages**: Public privacy policy and account-deletion request page for the certificate vault app
- **GharBato support pages**: Public privacy policy and account-deletion request page for the property marketplace app

## File Structure

```
portfolio/
├── index.html          # Main portfolio page
├── quiz.html           # Separate quiz page
├── style.css           # Complete styling
├── script.js           # Main portfolio functionality
├── quiz.js             # Quiz functionality
├── quiz-data.js        # Quiz questions and data
├── supabase-config.js  # Supabase publishable-key client for form submissions
├── project1.html       # Project detail page
├── studentos-privacy.html        # StudentOS privacy policy
├── studentos-delete-account.html # Public account-deletion request page
├── studentos-delete-account.js   # Submits requests to Supabase
├── gharbato-privacy.html         # GharBato privacy policy
├── gharbato-delete-account.html  # GharBato account-deletion request page
├── gharbato-support.css          # GharBato support-page theme
└── assets/             # Images and media files
```

Contact messages are stored in the Supabase `contact_messages` table. StudentOS account-deletion requests are stored separately in `account_deletion_requests`. Review them in the Supabase Dashboard under **Table Editor**. The forms do not send email notifications or delete accounts automatically; verify requests and fulfill them manually, including removing the user's certificate records and files.

## Security Features

- **Input Sanitization**: All user inputs are sanitized to prevent XSS attacks
- **Supabase Security**: Row-level security and insert-only grants protect submitted requests
- **Client Key Safety**: The website uses only a Supabase publishable key; never expose a secret/service-role key
- **Content Security**: HTML entities encoding for safe content display

## Run Locally

This is a static website; it has no build step or npm dependencies. From the
repository root, start a local web server:

```powershell
py -m http.server 8000
```

If `py` is unavailable, use `python -m http.server 8000`. Then open
<http://localhost:8000> in your browser. Stop the server with `Ctrl+C`.

Alternatively, open the repository in VS Code and use the Live Server
extension; the workspace is configured to use port `5501`.

The Supabase client configuration is in `supabase-config.js`. It currently uses
the same main-project URL and publishable key as the StudentOS local
configuration. For a test branch, replace both values with that branch's URL
and publishable key. Apply
`supabase/migrations/202610170001_website_requests.sql` from the StudentOS
repository to that Supabase project before relying on the forms. The static
pages can be viewed without a network connection; submissions require internet
access and the migration's grants and row-level security policies.

## Performance Optimizations

- **Modular Code**: Separated concerns into different files
- **Lazy Loading**: Quiz data loaded only when needed
- **Efficient DOM**: Minimal DOM manipulation and reflows
- **Optimized Images**: Proper image sizing and formats

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never put a Supabase secret or service-role key in browser code**
2. **A publishable key is public; use row-level security to control access**
3. **Keep the Supabase request tables write-only for public clients**
4. **Regularly update dependencies**
5. **Use HTTPS in production**

## License

© 2026 Manjil Basnet. All rights reserved.
