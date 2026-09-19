import sqlite3
import hashlib
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'library.db')

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def init_db():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("Removed existing database to re-initialize.")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Table Users (Phân quyền: admin, librarian, reader)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL, -- 'admin', 'librarian', 'reader'
        full_name TEXT NOT NULL,
        email TEXT,
        reader_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reader_id) REFERENCES readers(id) ON DELETE SET NULL
    )
    ''')

    # 2. Table Readers (Quản lý Độc giả)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS readers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reader_code TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        card_type TEXT NOT NULL, -- 'Sinh viên', 'Giảng viên', 'Độc giả ngoài'
        status TEXT NOT NULL DEFAULT 'Hoạt động', -- 'Hoạt động', 'Hết hạn', 'Bị khóa'
        issue_date DATE NOT NULL,
        expiry_date DATE NOT NULL
    )
    ''')

    # 3. Table Categories (Thể loại sách)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT
    )
    ''')

    # 4. Table Books (Quản lý Sách)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        publisher TEXT NOT NULL,
        publish_year INTEGER NOT NULL,
        total_qty INTEGER NOT NULL DEFAULT 1,
        available_qty INTEGER NOT NULL DEFAULT 1,
        rack_location TEXT DEFAULT 'Kệ A1',
        description TEXT,
        cover_url TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id)
    )
    ''')

    # 5. Table Borrow Records (Mượn/Trả/Gia hạn/Phạt)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS borrow_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        borrow_code TEXT UNIQUE NOT NULL,
        reader_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        borrow_date DATE NOT NULL,
        due_date DATE NOT NULL,
        return_date DATE,
        status TEXT NOT NULL DEFAULT 'Đang mượn', -- 'Đang mượn', 'Đã trả', 'Quá hạn'
        renewal_count INTEGER DEFAULT 0,
        fine_amount REAL DEFAULT 0,
        fine_status TEXT DEFAULT 'N/A', -- 'N/A', 'Chưa nộp', 'Đã nộp'
        notes TEXT,
        FOREIGN KEY (reader_id) REFERENCES readers(id),
        FOREIGN KEY (book_id) REFERENCES books(id)
    )
    ''')

    # 6. Table Reservations (Đặt trước sách khi hết)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        reader_id INTEGER NOT NULL,
        request_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'Đang chờ', -- 'Đang chờ', 'Đã duyệt', 'Đã hủy'
        queue_order INTEGER NOT NULL,
        FOREIGN KEY (book_id) REFERENCES books(id),
        FOREIGN KEY (reader_id) REFERENCES readers(id)
    )
    ''')

    # 7. Table Fine Logs (Nhật ký nộp tiền phạt)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS fine_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        borrow_id INTEGER NOT NULL,
        reader_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        reason TEXT,
        paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        payment_method TEXT DEFAULT 'Tiền mặt',
        FOREIGN KEY (borrow_id) REFERENCES borrow_records(id),
        FOREIGN KEY (reader_id) REFERENCES readers(id)
    )
    ''')

    print("Tables created successfully.")

    # --- SEED SAMPLE DATA ---

    # 1. Categories
    categories_data = [
        ('CNTT', 'Công nghệ Thông tin & AI', 'Sách về Lập trình, Trí tuệ Nhân tạo, Dữ liệu và Mạng máy tính'),
        ('VH', 'Văn học & Nghệ thuật', 'Tiểu thuyết, truyện ngắn, tác phẩm văn học Việt Nam và Thế giới'),
        ('KT', 'Kinh tế & Quản trị', 'Quản trị kinh doanh, Tài chính, Khởi nghiệp và Marketing'),
        ('KH', 'Khoa học & Kỹ thuật', 'Vật lý, Toán học, Sinh học, Công nghệ vũ trụ và Kỹ thuật'),
        ('LS', 'Lịch sử & Triết học', 'Lịch sử thế giới, Lịch sử Việt Nam, Triết học và Văn hóa'),
        ('KNS', 'Kỹ năng sống & Phát triển', 'Phát triển bản thân, Tư duy phản biện, Giao tiếp và Lãnh đạo')
    ]
    cursor.executemany("INSERT INTO categories (code, name, description) VALUES (?, ?, ?)", categories_data)

    # 2. Readers
    readers_data = [
        ('DG001', 'Nguyễn Văn An', 'an.nguyen@email.com', '0901234567', 'Sinh viên', 'Hoạt động', '2025-09-01', '2027-09-01'),
        ('DG002', 'Trần Thị Bình', 'binh.tran@email.com', '0912345678', 'Sinh viên', 'Hoạt động', '2025-09-01', '2027-09-01'),
        ('DG003', 'Lê Hoàng Cường', 'cuong.le@email.com', '0923456789', 'Giảng viên', 'Hoạt động', '2024-01-15', '2028-01-15')
    ]
    cursor.executemany('''
    INSERT INTO readers (reader_code, full_name, email, phone, card_type, status, issue_date, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', readers_data)

    # 3. Users (Auth)
    pass_hash_admin = hash_password('admin123')
    pass_hash_thuthu = hash_password('123456')
    pass_hash_docgia = hash_password('123456')

    users_data = [
        ('admin', pass_hash_admin, 'admin', 'Quản trị viên Hệ thống', 'admin@library.edu.vn', None),
        ('thuthu1', pass_hash_thuthu, 'librarian', 'Thủ thư Nguyễn Thị Mai', 'mai.thuthu@library.edu.vn', None),
        ('docgia1', pass_hash_docgia, 'reader', 'Nguyễn Văn An', 'an.nguyen@email.com', 1),
        ('docgia2', pass_hash_docgia, 'reader', 'Trần Thị Bình', 'binh.tran@email.com', 2),
        ('docgia3', pass_hash_docgia, 'reader', 'Lê Hoàng Cường', 'cuong.le@email.com', 3)
    ]
    cursor.executemany('''
    INSERT INTO users (username, password_hash, role, full_name, email, reader_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ''', users_data)

    # 4. Books
    books_data = [
        ('MS001', 'Nhập Môn Lập Trình Python', 'Guido van Rossum', 1, 'NXB Bách Khoa', 2023, 5, 3, 'Kệ A1-01', 
         'Cuốn sách căn bản dành cho người mới bắt đầu học lập trình Python. Hướng dẫn chi tiết cú pháp, cấu trúc dữ liệu, hàm và lập trình hướng đối tượng với nhiều ví dụ thực tế phong phú.', 
         'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&q=80'),
        
        ('MS002', 'Trí Tuệ Nhân Tạo & Học Máy', 'Andrew Ng', 1, 'NXB Tri Thức', 2024, 4, 1, 'Kệ A1-02', 
         'Giới thiệu tổng quan và chuyên sâu về Học máy (Machine Learning), Mạng nơ-ron nhân tạo (Neural Networks) và Trí tuệ nhân tạo tạo sinh (Generative AI). Phù hợp cho sinh viên và kỹ sư công nghệ.', 
         'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80'),
        
        ('MS003', 'Đắc Nhân Tâm', 'Dale Carnegie', 6, 'NXB Trẻ', 2022, 10, 8, 'Kệ F2-05', 
         'Tác phẩm nghệ thuật thu phục lòng người và giao tiếp ứng xử kinh điển. Giúp người đọc phát triển kỹ năng mềm, xây dựng mối quan hệ bền vững trong công việc và cuộc sống.', 
         'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80'),
         
        ('MS004', 'Dế Mèn Phiêu Lưu Ký', 'Tô Hoài', 2, 'NXB Kim Đồng', 2021, 6, 4, 'Kệ B3-12', 
         'Tác phẩm văn học thiếu nhi kinh điển của nhà văn Tô Hoài, kể về cuộc phiêu lưu tự do và đầy bài học nhân văn của chú Dế Mèn cùng các bạn nhỏ.', 
         'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&q=80'),
         
        ('MS005', 'Nhà Giả Kim (The Alchemist)', 'Paulo Coelho', 2, 'NXB Nhã Nam', 2023, 8, 0, 'Kệ B1-04', 
         'Hành trình đi tìm kho báu và lắng nghe tiếng gọi trái tim của chàng chăn cừu Santiago. Cuốn sách truyền cảm hứng sống và đuổi theo ước mơ lớn nhất đời người.', 
         'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400&q=80'),
         
        ('MS006', 'Quản Trị Kinh Doanh Hiện Đại', 'Philip Kotler', 3, 'NXB Thống Kê', 2023, 3, 2, 'Kệ C2-01', 
         'Giáo trình quản trị toàn diện dành cho nhà quản lý và doanh nhân. Cung cấp kiến thức nền tảng về chiến lược kinh doanh, marketing và quản trị tài chính doanh nghiệp.', 
         'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&q=80'),

        ('MS007', 'Lược Sử Loài Người (Sapiens)', 'Yuval Noah Harari', 5, 'NXB Tri Thức', 2022, 5, 2, 'Kệ E1-08', 
         'Khám phá hành trình tiến hóa của loài người từ thời kỳ đồ đá cho đến kỷ nguyên trí tuệ nhân tạo và công nghệ sinh học. Phân tích sâu sắc lịch sử, văn hóa và nhận thức xã hội.', 
         'https://images.unsplash.com/photo-1461360370896-922624d12aa1?w=400&q=80'),

        ('MS008', 'Vật Lý Đại Đại Toàn Tập', 'Stephen Hawking', 4, 'NXB Khoa Học Kỹ Thuật', 2023, 4, 3, 'Kệ D1-03', 
         'Giải thích các bí ẩn vũ trụ, hố đen, lý thuyết tương đối và cơ học lượng tử một cách cuốn hút và trực quan dành cho người yêu khoa học.', 
         'https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=400&q=80'),

        ('MS009', 'Lập Trình Web Full-Stack với React & Node.js', 'Nguyễn Thanh Tùng', 1, 'NXB Lao Động', 2024, 6, 5, 'Kệ A2-05', 
         'Hướng dẫn xây dựng ứng dụng web hiện đại từ giao diện Frontend với React đến hệ thống Backend RESTful API với Node.js, Express và MongoDB/PostgreSQL.', 
         'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&q=80'),

        ('MS010', 'Tư Duy Nhanh Và Chậm', 'Daniel Kahneman', 6, 'NXB Thế Giới', 2022, 4, 1, 'Kệ F1-02', 
         'Cuốn sách tâm lý học kinh điển phân tích hai hệ thống tư duy chi phối mọi quyết định của con người: Hệ thống 1 (nhanh, cảm tính) và Hệ thống 2 (chậm, lý tính).', 
         'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&q=80'),

        ('MS011', 'Clean Code - Mã Sạch và Nghệ Thuật Lập Trình', 'Robert C. Martin (Uncle Bob)', 1, 'NXB Lao Động', 2023, 6, 5, 'Kệ A1-03',
         'Cuốn sách gối đầu giường về nguyên lý lập trình sạch, refactoring và viết mã dễ bảo trì cho các lập trình viên chuyên nghiệp.',
         'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&q=80'),

        ('MS012', 'Hệ Thống Thiết Kế Design Systems', 'Alla Kholmatova', 1, 'NXB Bách Khoa', 2024, 6, 4, 'Kệ A1-08',
         'Hướng dẫn xây dựng hệ thống thiết kế giao diện UI/UX đồng bộ, linh hoạt và chuẩn hóa cho sản phẩm số.',
         'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=400&q=80'),

        ('MS013', 'Tuần Làm Việc 4 Giờ', 'Timothy Ferriss', 6, 'NXB Thế Giới', 2022, 8, 6, 'Kệ B2-08',
         'Bí quyết thoát khỏi nhịp sống văn phòng rập khuôn, tối ưu hóa hiệu suất công việc và tự do tài chính.',
         'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80'),

        ('MS014', 'Rừng Na-uy', 'Haruki Murakami', 2, 'NXB Hội Nhà Văn', 2022, 7, 5, 'Kệ C1-08',
         'Tiểu thuyết lừng danh về tuổi trẻ, tình yêu, sự cô đơn và những trăn trở của thanh xuân thế hệ 1960.',
         'https://images.unsplash.com/photo-1474939557548-f842486be195?w=400&q=80'),

        ('MS015', 'Khéo Ăn Khéo Nói Sẽ Có Được Cả Thiên Hạ', 'Trác Nhã', 6, 'NXB Văn Học', 2023, 10, 8, 'Kệ B2-12',
         'Nghệ thuật ứng xử, đàm phán và giao tiếp tinh tế trong công việc, cuộc sống giúp bạn thành công hơn.',
         'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&q=80')
    ]
    cursor.executemany('''
    INSERT INTO books (book_code, title, author, category_id, publisher, publish_year, total_qty, available_qty, rack_location, description, cover_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', books_data)

    # 5. Borrow Records
    borrow_records_data = [
        ('PM001', 1, 1, '2026-08-15', '2026-08-29', None, 'Đang mượn', 0, 0, 'N/A', 'Mượn phục vụ bài tập lớn Python'),
        ('PM002', 2, 2, '2026-08-20', '2026-09-03', None, 'Đang mượn', 1, 0, 'N/A', 'Đã gia hạn 1 lần (+7 ngày)'),
        ('PM003', 2, 5, '2026-08-01', '2026-08-15', None, 'Quá hạn', 0, 140000, 'Chưa nộp', 'Quá hạn 28 ngày'),
        ('PM006', 1, 6, '2026-08-25', '2026-09-08', None, 'Đang mượn', 0, 0, 'N/A', 'Mượn nghiên cứu Quản trị Kinh doanh')
    ]
    cursor.executemany('''
    INSERT INTO borrow_records (borrow_code, reader_id, book_id, borrow_date, due_date, return_date, status, renewal_count, fine_amount, fine_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', borrow_records_data)

    # 6. Fine Logs
    cursor.execute('''
    INSERT INTO fine_logs (borrow_id, reader_id, amount, reason, paid_at, payment_method)
    VALUES (1, 1, 105000, 'Phạt trả quá hạn cho sách MS001', '2026-09-10 10:30:00', 'Tiền mặt')
    ''')

    # 7. Reservations
    cursor.execute('''
    INSERT INTO reservations (book_id, reader_id, request_date, status, queue_order)
    VALUES (5, 1, '2026-09-01 09:15:00', 'Đang chờ', 1)
    ''')
    cursor.execute('''
    INSERT INTO reservations (book_id, reader_id, request_date, status, queue_order)
    VALUES (5, 2, '2026-09-02 14:00:00', 'Đang chờ', 2)
    ''')

    conn.commit()
    conn.close()
    print("Database library.db successfully created & seeded with realistic library data!")

if __name__ == '__main__':
    init_db()
