# UjenziSmart Backend

This backend provides simple APIs for:
- User auth (register/login)
- Product catalog (construction material)
- Orders (checkout + stock deduction)

## Run

1. `cd backend`
2. `npm install`
3. `npm start`

Open `http://localhost:5000/login.html` to use existing frontend login page.

## Endpoints

- `GET /api/auth/check-email?email=...`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/products`
- `POST /api/products` (admin)
- `GET /api/orders`
- `POST /api/orders`
