import { pool } from '../config/db.js';

export const LoanModel = {
  async createLoan(book_id, member_id, due_date) {
    const client = await pool.connect(); // Menggunakan client untuk transaksi
    try {
      await client.query('BEGIN'); // Mulai transaksi database

      // 1. Cek ketersediaan buku
      const bookCheck = await client.query('SELECT available_copies FROM books WHERE id = $1', [book_id]);
      if (bookCheck.rows[0].available_copies <= 0) {
        throw new Error('Buku sedang tidak tersedia (stok habis).');
      }

      // 2. Kurangi stok buku
      await client.query('UPDATE books SET available_copies = available_copies - 1 WHERE id = $1', [book_id]);

      // 3. Catat transaksi peminjaman
      const loanQuery = `
        INSERT INTO loans (book_id, member_id, due_date) 
        VALUES ($1, $2, $3) RETURNING *
      `;
      const result = await client.query(loanQuery, [book_id, member_id, due_date]);

      await client.query('COMMIT'); // Simpan semua perubahan
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK'); // Batalkan jika ada error
      throw error;
    } finally {
      client.release();
    }
  },

  async getAllLoans() {
    const query = `
      SELECT l.*, b.title as book_title, m.full_name as member_name 
      FROM loans l
      JOIN books b ON l.book_id = b.id
      JOIN members m ON l.member_id = m.id
    `;
    const result = await pool.query(query);
    return result.rows;
  }, // <-- PENTING: Tambahan koma di sini untuk memisahkan fungsi

  // FUNGSI BARU UNTUK TOP 3 BORROWERS
  async getTopBorrowers() {
    const query = `
      WITH MemberStats AS (
          SELECT 
              m.id, 
              m.full_name, 
              m.email, 
              m.member_type, 
              m.joined_at,
              COUNT(l.id) AS total_pinjaman,
              MAX(l.loan_date) AS pinjaman_terakhir
          FROM members m
          JOIN loans l ON m.id = l.member_id
          GROUP BY m.id
      ),
      FavoriteBooks AS (
          SELECT 
              l.member_id, 
              b.title AS buku_favorit,
              ROW_NUMBER() OVER(PARTITION BY l.member_id ORDER BY COUNT(l.id) DESC) as rn
          FROM loans l
          JOIN books b ON l.book_id = b.id
          GROUP BY l.member_id, b.title
      )
      SELECT 
          ms.id, 
          ms.full_name, 
          ms.email, 
          ms.member_type, 
          ms.joined_at,
          CAST(ms.total_pinjaman AS INTEGER) as total_pinjaman,
          fb.buku_favorit,
          ms.pinjaman_terakhir
      FROM MemberStats ms
      JOIN FavoriteBooks fb ON ms.id = fb.member_id AND fb.rn = 1
      ORDER BY ms.total_pinjaman DESC
      LIMIT 3;
    `;
    const result = await pool.query(query);
    return result.rows;
  }
};
