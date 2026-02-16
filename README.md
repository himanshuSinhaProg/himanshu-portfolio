## Portfolio Website – Build Log

### Feb 08, 2026
- Cleaned repository structure
- Validated CI/CD pipeline (GitHub → Azure)
- Implemented Cities image gallery
- Confirmed static asset serving(tested)



---

###  Feb 13, 2026

- Created SendGrid account and generated API key
- Configured SENDGRID_API_KEY as secure environment variable in Azure
- Installed @sendgrid/mail package
- Implemented test email endpoint to validate integration
- Created interest.html form for photo inquiries
- Updated cities.html to link “Express Interest” buttons to the form
- Implemented backend /api/interest route to send confirmation email to customer and notification email to admin
- Verified full end-to-end flow:

   
FLOW : Form submission → Azure backend → SendGrid → Email delivery


### 🏗 Current Architecture

Frontend (HTML form)
→ Express backend (`/api/interest`)
→ SendGrid API
→ Email delivery

---

### 📌 Next Planned Enhancements

* Pass selected image ID to interest form
* Store submissions in persistent storage
* Admin upload panel (Azure Blob Storage)
* Replace manual transfer with Stripe integration

Feb 16 - Product Launch

