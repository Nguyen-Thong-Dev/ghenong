# BỘ LUẬT GAME GHẾ NÓNG — PHIÊN BẢN 1.0

Ngày biên soạn: 08/11/2026. Dự án: Tiktok.
Tên làm việc: Giữ Ghế Đi! (chưa phải tên thương mại cuối cùng).
Mục đích: tài liệu thiết kế và tiêu chí nghiệm thu để phát triển bằng Antigravity.

## 1. Phạm vi và nguyên tắc

Mô hình đã thống nhất: sân đấu có 5 ghế nóng và 1 MC; khán đài chữ U; hàng chờ trực quan 10 ghế; một màn hình câu hỏi chung; mỗi ghế nóng có kết quả độc lập. Người sai hoặc không trả lời xuống khán đài, người chờ tự lên thay. Có vinh danh giữa màn hình khoảng 3 giây. Phong cách 2D có chiều sâu 2.5D, rõ ràng trên điện thoại.

Các thông số cụ thể trong tài liệu này là quyết định thiết kế cho bản thử 1.0. Chúng có thể được điều chỉnh sau thử nghiệm, phải ghi phiên bản mới và không đổi ngầm giữa câu.

- Người chơi tham gia và có cơ hội lên ghế bằng bình luận, không cần tặng quà.
- Cả khán đài, ghế chờ và ghế nóng đều có thể trả lời câu hỏi.
- Đúng: có điểm. Riêng ghế nóng còn tăng cấp và giữ ghế.
- Sai/hết giờ: chỉ người ở ghế nóng mất ghế; người chờ không mất thứ tự vì trả lời sai.
- Không giới hạn số câu một người được giữ ghế nếu tiếp tục trả lời đúng.
- Không thưởng tốc độ trả lời trong v1.0.
- Điểm, cấp và huy hiệu là thành tích trong game, không quy đổi thành tiền hoặc quà vật chất trong v1.0.

## 2. Các trạng thái người chơi

| Trạng thái | Ý nghĩa |
|---|---|
| KHÁN GIẢ | Có hồ sơ, chưa đăng ký hoặc đang tắt tự xếp hàng |
| ĐÃ ĐĂNG KÝ | Đã có số thứ tự, nhưng chưa nằm trong 10 vị trí đầu |
| GHẾ CHỜ | Một trong 10 vị trí đầu của danh sách đăng ký |
| ĐƯỢC MỜI | Được dành một ghế nóng cụ thể, chờ xác nhận |
| GHẾ NÓNG | Đang thi tại ghế 1–5 |
| TẠM KHÓA | Bị quản trị viên hạn chế tham gia do vi phạm |

Một tài khoản chỉ được thuộc một trạng thái và một vị trí tại một thời điểm. MC là nhân vật dẫn chương trình, không chiếm ghế và không có điểm.

Nhận diện bằng định danh tài khoản ổn định do nguồn kết nối cung cấp, không dùng tên hiển thị. Không ghép hai tài khoản chỉ vì trùng tên. Khi chưa có định danh đáng tin cậy, không ghi điểm/ghế cho sự kiện đó; ghi lỗi để xử lý. Tên đổi không làm mất hồ sơ.

## 3. Tham gia và các lệnh

| Lệnh | Tác dụng |
|---|---|
| vao / vào | Tạo hồ sơ nếu chưa có, đưa vào khán đài; không tự đăng ký ghế |
| cho / chờ | Đăng ký cuối hàng, bật tự xếp lại sau khi rớt |
| huy / hủy | Rời danh sách chờ, hủy lời mời nếu có, tắt tự xếp lại; nếu đang ghế nóng thì vẫn giữ ghế đến khi nhường/rớt |
| ss / sẵn sàng | Chỉ có hiệu lực khi đang được mời lên ghế |
| nhuong / nhường | Nếu ở ghế nóng: yêu cầu rời ghế và tắt tự xếp lại |
| 23A, 23B, 23C, 23D | Đáp án cho câu có mã 23 |
| diem / điểm | Yêu cầu hiện tóm tắt điểm và kỷ lục trên bảng thông tin trong game |
| vitri / vị trí | Yêu cầu hiện vị trí hàng chờ hoặc số ghế nóng |

Lệnh không phân biệt chữ hoa/thường; chấp nhận khoảng trắng đầu/cuối. Đáp án chấp nhận “23 b” và chuẩn hóa thành “23B”. Không nhận riêng A/B/C/D, không đọc đáp án từ một câu văn dài, không nhận nhiều lựa chọn trong một bình luận. Mỗi thông báo có hướng dẫn đúng cú pháp để người mới hiểu.

Đáp án hợp lệ của tài khoản mới tự tạo hồ sơ khán giả và chấm điểm nhưng không tự đăng ký lên ghế. Gửi lại “chờ” không đổi thứ tự. “Điểm/vị trí” có thời gian chờ 15 giây mỗi người, thông báo được xếp hàng và giới hạn hiển thị để không che đề. Không phụ thuộc vào tính năng gửi tin nhắn tự động lại TikTok.

## 4. Hàng chờ và thứ tự lên ghế

Hàng chờ là một danh sách logic duy nhất. Mười vị trí đầu được biểu diễn bằng 10 ghế; phần còn lại là người đăng ký đang ngồi khán đài. Số thứ tự được cấp tăng dần bởi máy chủ khi nhận đăng ký, không dựa vào giờ trên máy người xem.

1. Ghế nóng trống được xử lý theo số ghế tăng dần: 1 → 5.
2. Lấy người ở đầu hàng và dành riêng người đó cho một ghế trống.
3. Hiện tên, số ghế và đếm ngược xác nhận 12 giây. Người đó bình luận “ss”.
4. Có xác nhận: chuyển thành người chơi ghế nóng, cấp khởi đầu 0.
5. Không xác nhận: hủy đăng ký và tắt tự xếp lại; đưa về khán đài. Có thể đăng ký lại sau.
6. Các lời mời cho nhiều ghế có thể chạy đồng thời. Tối đa 2 đợt mời trong một lần chuyển câu, tránh chờ mãi.
7. Sau 2 đợt, ghế chưa có người được để trống tới lần chuyển câu tiếp theo. Không thay ghế giữa lúc một câu đang nhận đáp án.

Khi người đã vào ghế, ghế chờ tự dồn và bổ sung từ danh sách khán giả đăng ký. Người được mời tạm thời tách khỏi hàng, không còn chiếm một ghế chờ.

Nếu không có ai ở ghế nóng nhưng vẫn có khán giả hoạt động, câu hỏi vẫn chạy cho khán giả và việc mời được thử ở ranh giới câu tiếp. Khi không có tương tác game hợp lệ trong 120 giây và không còn người ghế nóng, chuyển sang màn hình chờ. Tương tác mới sẽ đánh thức game. Không suy đoán một người rời live chỉ từ việc không nhận được sự kiện rời phòng.

## 5. Khi rớt hoặc nhường ghế

- Trả lời sai: kết thúc lượt giữ ghế khi chấm câu. Nếu đã bật tự xếp lại, đăng ký lại ở cuối hàng tại thời điểm đó.
- Không có đáp án hợp lệ lúc hết giờ: kết thúc lượt; về khán đài và tắt tự xếp lại để tránh vòng gọi người vắng mặt. Muốn chơi tiếp gửi “chờ”.
- Chủ động nhường: kết thúc lượt, tắt tự xếp lại. Nếu câu đang mở, ghế chỉ được bổ sung sau câu đó.
- Nếu nhiều người sai cùng câu: thêm vào cuối hàng theo số ghế tăng dần; tất cả đứng sau những người đã đăng ký trước lúc chấm câu.
- Không trừ điểm đã kiếm, không xóa kỷ lục/huy hiệu. Cấp hiện tại của lượt ngồi kết thúc.
- Không có thời gian cấm quay lại bắt buộc. Với ít người, người vừa sai có thể được gọi lại nếu đã tới lượt, nhưng vẫn phải xác nhận.

Đã gửi đáp án rồi mới nhường: nếu đáp án đúng vẫn được điểm của câu, nhưng không tăng cấp/chuỗi ghế nóng. Từ khi nhường, các câu sau được chấm theo vai khán giả.

## 6. Vòng đời một câu

| Giai đoạn | Mặc định | Quy tắc |
|---|---:|---|
| CHUẨN BỊ | 5 giây | Hiện chủ đề/mã câu, chốt danh sách người đang ghế nóng; chưa lộ đề/đáp án |
| MỞ ĐÁP ÁN | 30 giây | Hiện đồng thời câu hỏi, 4 lựa chọn, đồng hồ; bắt đầu nhận |
| KHÓA VÀ CHẤM | Tối đa 1 giây mục tiêu | Khóa nhận rồi tính kết quả một lần |
| CÔNG BỐ | 5 giây | Hiện đáp án đúng, giải thích ngắn và kết quả từng ghế |
| VINH DANH | 3 giây | Một hiệu ứng chung, có mức độ theo thành tích |
| CHUYỂN GHẾ | 4 giây + đợt mời nếu cần | Người rớt xuống, người mới xác nhận và vào chỗ |

Một câu không đổi ghế dự kiến khoảng 48 giây cộng thời gian xử lý nhỏ. Khi cần mời người mới, thêm tối đa 24 giây xác nhận. Đây là mục tiêu thử nghiệm, không cam kết độ trễ nền tảng.

MC đọc trong thời gian mở đáp án; lời đọc phải ngắn, không kéo dài quá thời gian đã định. Giọng MC thu sẵn/TTS soạn sẵn; lời nhận xét không quyết định đáp án. Người vận hành có thể tắt tiếng mà game vẫn chạy.

## 7. Chấp nhận và khóa đáp án

- Mã câu tăng liên tục trong một phiên live; không quay lại câu 1 khi đổi hiệp. Mỗi câu có ID nội bộ riêng và mã công khai.
- Máy chủ dùng thời điểm nhận sự kiện đã chuẩn hóa để xét hạn. Nhận khi now < thời điểm đóng mới hợp lệ; đúng bằng thời điểm đóng là trễ.
- Cửa sổ nhận chỉ mở trong trạng thái MỞ ĐÁP ÁN. Gửi sớm, gửi trễ, gửi sai mã đều không tính và không giữ chỗ đáp án.
- Đáp án hợp lệ đầu tiên được khóa; không sửa trong v1.0. Bình luận sai cú pháp không làm mất quyền gửi lại đúng cú pháp.
- Sự kiện trùng không được xử lý lại. Mỗi tài khoản chỉ có tối đa một kết quả chấm cho mỗi câu, bất kể số bình luận.
- Người đang ngồi ghế hiển thị “Đã trả lời” khi đã nhận, chưa lộ A/B/C/D. Khán giả chỉ hiện trạng thái hoặc tổng số người đã trả lời.
- Không thưởng nhanh, không dùng thời gian trả lời để phân hạng.
- Tăng thời gian đáp án chỉ áp dụng từ câu tiếp theo; không âm thầm nhận thêm sau khi công bố hết giờ.

Lưu ý vận hành: bình luận TikTok là công khai, người xem vẫn có thể đọc lựa chọn của nhau. Game này là sân chơi cộng đồng, không thể tuyên bố kiểm soát gian lận như một kỳ thi kín. Giao diện game không tiết lộ thêm đáp án trước lúc khóa.

## 8. Cấp bậc, điểm và kỷ lục

Mỗi lần lên ghế bắt đầu Cấp 0. Mỗi câu đúng trong thời gian giữ ghế tăng đúng 1 cấp. Không có trần cấp và không tự buộc nhường ghế khi đạt mốc.

| Cấp hiện tại | Danh hiệu |
|---:|---|
| 0 | Tân binh |
| 1–2 | Khởi động |
| 3–5 | Đầu lạnh |
| 6–9 | Cao thủ |
| 10–14 | Bậc thầy |
| 15+ | Huyền thoại |

Điểm cho mọi vai: đúng +10; sai hoặc không trả lời +0. Không nhân điểm vì đang ghế nóng, vì quà tặng hay vì trả lời nhanh. Cấp ghế nóng và điểm tổng là hai đại lượng khác nhau.

Lưu riêng: cấp lượt hiện tại, kỷ lục cấp trong phiên, kỷ lục mọi phiên, điểm hiệp, điểm phiên, số câu đúng phiên và lịch sử huy hiệu. Sai không làm giảm điểm tổng. Huy hiệu mốc 3/6/10/15 được lưu khi lần đầu đạt; các lần sau vẫn có hiệu ứng mốc trong lượt mới.

## 9. Hiệp và bảng xếp hạng

- Một phiên là một buổi live do người vận hành bắt đầu/kết thúc; thời lượng có thể khoảng 6 giờ.
- Một hiệp kéo dài 30 phút thời gian game hoạt động, không tính lúc tạm dừng hoặc chờ không người. Nếu tới mốc giữa câu, hoàn tất công bố và chuyển ghế rồi mới đóng hiệp. Câu vừa xong thuộc hiệp cũ.
- Chốt bảng hiệp và hiện 8 giây, sau đó đặt lại điểm hiệp. Không thay ghế, không xóa cấp lượt đang giữ và không đổi thứ tự chờ.
- Bảng điểm hiệp/phiên xếp theo điểm giảm dần. Bằng điểm được đồng hạng; thứ tự hiển thị ổn định chỉ phục vụ bố cục, không tạo ưu tiên chơi.
- Bảng kỷ lục giữ ghế xếp theo cấp cao nhất, bằng cấp đồng hạng.
- Chỉ hiển thị top 5 gọn ở sân khấu, có màn hình tổng kết xem thêm; không che câu hỏi.
- Kết thúc live chủ động: chốt sau câu đang chơi; giữ điểm lịch sử/kỷ lục/huy hiệu, kết thúc lượt giữ ghế và xóa hàng chờ. Phiên mới bắt đầu cấp 0 và đăng ký mới.
- Khôi phục do sự cố là tiếp tục phiên cũ, không phải mở phiên mới.

## 10. Vinh danh và nhân vật

Sau mỗi câu hợp lệ, dùng tối đa một khối vinh danh giữa màn hình dài 3 giây:
- Có người đạt cấp 3/6/10/15 hoặc phá kỷ lục cá nhân đã có từ trước: vinh danh người đó. Một kỷ lục mới trong cùng lượt chỉ thông báo lớn lần đầu vượt kỷ lục cũ của lượt; các cấp tiếp theo không tạo thêm lễ phá kỷ lục.
- Nhiều người đạt cùng lúc: gộp avatar, tên và cấp trên một bảng.
- Không có mốc: hiện ngắn “N người giữ ghế”, các ghế đúng sáng lên, có +1 cấp.
- Nếu đủ 5 ghế và cả 5 đúng: có dòng “CẢ SÀN GIỮ GHẾ!”. Nếu có mốc cá nhân, gộp trong cùng bảng.
- Không ai đúng ở ghế nóng: thông báo trung tính “Sân đấu đón lượt mới”. Không chế giễu người sai.

Hoạt ảnh: chờ suy nghĩ, xác nhận đã trả lời, đúng, sai, đi xuống, đi lên. Hiệu ứng phải kết thúc đúng lịch, không cản nhận lệnh. Trạng thái trên máy chủ không phụ thuộc việc hoạt ảnh đã chạy xong trên một máy xem hay chưa.

## 11. Khán đài và thể hiện bản thân

- Người chơi có avatar, tên hiển thị và nhân vật đại diện. Bộ mẫu nhân vật được lựa chọn/đổi trong bản mở rộng; v1.0 có thể gán mẫu ổn định theo tài khoản.
- Hiển thị đầy đủ 5 người ghế nóng, 10 người ghế chờ. Khán đài mặc định tối đa 40 nhân vật trong khung hình; người khác vẫn chơi bình thường.
- Khán đài luân phiên người hoạt động ở ranh giới câu; không thay nhân vật liên tục lúc đọc đề. Giới hạn hiển thị không phải giới hạn số hồ sơ hay người chấm điểm.
- Tên dài được rút gọn trên ghế; trang quản trị lưu tên đầy đủ. Nội dung tên/bình luận không an toàn có thể được ẩn mà không làm mất định danh.
- V1.0 không hiển thị nguyên văn mọi bình luận tự do; chỉ hiển thị lệnh, trạng thái và thông báo được định dạng.

## 12. Ngân hàng câu hỏi

- Mỗi câu có nội dung, 4 lựa chọn khác nhau, đúng một đáp án, giải thích ngắn, chủ đề, mức khó, nguồn kiểm chứng khi cần và trạng thái đã duyệt.
- Chỉ phát câu đã duyệt. Không tự sinh rồi phát trực tiếp câu chưa kiểm tra.
- Mức khó là nhịp chung, không phụ thuộc cấp của từng ghế. Trong mỗi nhóm 10 câu: 3 dễ, 5 vừa, 2 khó; xáo thứ tự, không hai câu khó liên tiếp nếu có đủ nội dung.
- Không quá 3 câu liên tiếp cùng chủ đề. Không lặp ID câu trong một phiên; câu bị hủy cũng không dùng lại ngay trong phiên.
- Lựa chọn giữ thứ tự đã duyệt trong v1.0; không tự đảo nếu có nội dung phụ thuộc thứ tự.
- Hết câu hợp lệ: chuyển sang màn hình nghỉ, cảnh báo quản trị. Không tự lặp câu cũ hoặc bịa câu mới.
- Một buổi 6 giờ ở nhịp 48–72 giây/câu có thể cần khoảng 300–450 câu; chuẩn bị tối thiểu 500 câu đã duyệt để có dự phòng. Đây là ước lượng nội dung, cần hiệu chỉnh sau chạy thử.
- Tránh câu chủ quan có nhiều cách đúng; các câu thời sự hoặc phụ thuộc thời điểm phải được rà soát lại trước buổi live.

## 13. Quà tặng và công bằng

V1.0 nhận quà cho hiệu ứng trang trí/cổ vũ và lời cảm ơn, không đổi điểm, đáp án, cấp, hàng chờ hoặc quyền giữ ghế. Bình luận vẫn đủ để tham gia toàn bộ vòng chơi.

Hiệu ứng quà đặt ngoài vùng đề và đáp án, tối đa 2 giây, có giới hạn tần suất; nhiều quà được gộp thông báo. Chuỗi quà phải được chống tính lặp. Các quyền cứu mạng/50:50/ưu tiên ghế không thuộc v1.0.

## 14. Tạm dừng, câu lỗi và sự cố

| Tình huống | Xử lý bắt buộc |
|---|---|
| Kết nối TikTok báo mất trong lúc mở câu | Tạm dừng và hủy câu đang mở; không loại ai, không cộng điểm; giữ ghế và thứ tự |
| Kết nối mất sau khi câu đã chấm thành công | Giữ kết quả đã chấm; tạm dừng trước câu tiếp |
| Quản trị tạm dừng khi câu mở | Hủy câu, không tái dùng câu đã lộ; tiếp tục bằng câu mới |
| Tạm dừng trong bước mời | Giữ nguyên các chỗ dành; khi tiếp tục cấp lại đủ 12 giây cho lời mời đang mở |
| Một người không trả lời, nguồn kết nối vẫn khỏe | Áp dụng hết giờ; không thể suy đoán lỗi mạng riêng của người đó |
| Mất dữ liệu hàng loạt đáng ngờ | Quản trị có thể hủy câu; không tự kết luận chỉ dựa vào số người trả lời thấp |
| Máy chủ khởi động lại lúc câu đang mở | Khôi phục phiên, hủy câu chưa chấm, giữ trạng thái trước câu và mở câu mới sau khi kết nối khỏe |
| Máy chủ khởi động lại sau khi đã chấm | Không chấm lại; khôi phục kết quả và tiếp tục bước chuyển ghế còn dở |
| Giao diện sân khấu tải lại | Đồng bộ trạng thái máy chủ; không tự đặt lại câu, cấp hoặc đồng hồ |
| Câu bị phát hiện sai | Hủy trước chấm; nếu vừa chấm, dùng hoàn tác câu gần nhất theo quy tắc dưới |

Hoàn tác câu gần nhất: chỉ được thực hiện khi câu kế tiếp chưa mở. Khôi phục các thay đổi của câu đó về điểm, cấp, kỷ lục, huy hiệu, ghế và hàng chờ. Giữ các đăng ký/hủy thủ công phát sinh sau thời điểm chụp trạng thái bằng cách phát lại theo nhật ký. Hủy lời mời phát sinh từ câu bị hoàn tác. Sau khi câu kế tiếp mở, không hoàn tác dây chuyền tự động; quản trị tạm dừng, đánh dấu câu lỗi, công bố và xử lý từ nhật ký. Mọi điều chỉnh phải lưu người thực hiện và lý do.

## 15. Công cụ quản trị tối thiểu

- Bắt đầu, kết thúc phiên; tạm dừng/tiếp tục; xem trạng thái kết nối.
- Duyệt, thêm, tắt câu hỏi; xem số câu hợp lệ còn lại.
- Hủy câu, hoàn tác câu gần nhất khi đủ điều kiện.
- Xem danh sách chờ đầy đủ, ghế nóng, lời mời và kết quả nhận đáp án.
- Cho người rời ghế/khóa tài khoản vi phạm; có lý do, ghi nhật ký. Không có nút âm thầm đẩy tài khoản lên đầu hàng trong thao tác thường ngày.
- Chỉnh thông số cho câu/hiệp tiếp theo; lưu lịch sử cấu hình.
- Sao lưu, xuất nhật ký, khôi phục phiên và kiểm tra kết nối giả lập.
- Trang quản trị yêu cầu xác thực; khán giả không được gọi chức năng quản trị hay tự ghi điểm.

## 16. Dữ liệu và yêu cầu đối với Antigravity

Máy chủ là nơi duy nhất quyết định đồng hồ, điểm, thứ tự, cấp và kết quả. Giao diện chỉ gửi yêu cầu/hiển thị; không được chứa đáp án đúng có thể truy cập trước khi khóa câu ở giao diện công khai.

Cần lưu: hồ sơ tài khoản, phiên, hiệp, câu đang chạy và hạn nhận, đáp án đầu tiên, sự kiện đã xử lý, lượt giữ ghế, danh sách hàng chờ, lời mời, điểm, kỷ lục, huy hiệu, lịch sử điều chỉnh và dữ liệu phục hồi.

Chấm câu và các thay đổi điểm/cấp/trạng thái phải nhất quán, chỉ có hiệu lực một lần. Phải phân biệt “đã chấm” với “đã phát hoạt ảnh”. Danh sách chờ cần thứ tự ổn định kể cả sau khi khởi động lại. Ghi nhận trạng thái tiếp nhận sự kiện để tránh xử lý lại dữ liệu cũ sau khi nối lại.

Không cần gọi AI ở mỗi bình luận. MC và câu hỏi dùng nội dung đã soạn. Không cần máy chủ 3D; ưu tiên 2D có chiều sâu và tài nguyên nhẹ. Môi trường chạy cuối được kiểm tra trên VPS thực tế; tài liệu này không chứng nhận cấu hình VPS đủ tải.

## 17. Bộ kiểm tra nghiệm thu bắt buộc

| Mã | Tình huống thử | Kết quả đạt |
|---|---|---|
| T01 | Cùng tài khoản gửi “chờ” 20 lần | Chỉ có một vị trí, không nhảy hàng |
| T02 | 5 người cùng gửi ss | Mỗi người đúng ghế đã dành, không chiếm chéo |
| T03 | Ghế 2 và 5 sai, ba ghế còn lại đúng | Chỉ thay 2 và 5; cấp ba người còn lại tăng đúng 1 |
| T04 | Cả 5 sai | Thay theo thứ tự ghế, không trùng người |
| T05 | Người được mời im lặng | Hết 12 giây bỏ lời mời, người tiếp theo được gọi; không treo game |
| T06 | Gửi đáp án sớm, muộn, sai mã, nhiều lựa chọn | Không tính; đáp án đúng cú pháp đầu tiên trong hạn mới khóa |
| T07 | Lặp cùng sự kiện hoặc gửi 10 đáp án | Một đáp án và tối đa 10 điểm/câu |
| T08 | Khán giả mới trả lời giữa câu | Được chấm điểm, không tự vào hàng |
| T09 | Ghế nóng không trả lời | Rớt, không tự tái xếp; kỷ lục/điểm còn |
| T10 | Nhiều người đạt mốc | Một bảng vinh danh 3 giây |
| T11 | Tới cuối hiệp giữa câu | Câu thuộc hiệp cũ; không mất ghế/cấp/hàng chờ |
| T12 | Mất kết nối lúc nhận đáp án | Câu hủy, không loại hàng loạt |
| T13 | Khởi động lại trước/sau khi chấm | Không mất dữ liệu đã chốt, không cộng đôi |
| T14 | Hoàn tác sau công bố, trước câu kế | Phục hồi điểm/ghế/hàng chờ đúng, giữ đăng ký/hủy mới |
| T15 | Tặng quà lớn/chuỗi quà | Không đổi điểm, thứ tự hoặc kết quả |
| T16 | 100 tài khoản giả lập cùng trả lời | Nhận/chấm đúng dù chỉ vẽ 40 khán giả; đây là mức kiểm thử đầu, không phải cam kết sức chứa tối đa |
| T17 | Hết ngân hàng câu hỏi | Dừng có thông báo, không tự lặp |
| T18 | Nhường sau khi gửi đáp án | Đúng vẫn +10, không tăng cấp; ghế chỉ thay ở ranh giới câu |
| T19 | Tắt/mở giao diện hoặc ngắt phiên điều khiển VPS | Xác minh game và luồng phát có tiếp tục theo cấu hình vận hành; ghi nhận mọi giới hạn thực tế |
| T20 | Chạy mô phỏng liên tục 6 giờ | Không treo hàng chờ, không lệch điểm, không tích tụ hiệu ứng; theo dõi RAM/CPU/GPU và nhật ký |

## 18. Trình tự phát triển

1. Lập trình luật và bộ giả lập bình luận, kiểm tra T01–T18 bằng dữ liệu giả.
2. Dựng sân khấu 5 ghế + MC + 10 ghế chờ + khán đài U, gắn trạng thái thật.
3. Thêm lưu dữ liệu, khôi phục, công cụ quản trị và nhật ký.
4. Nối TikTok, kiểm tra độ trễ/định danh/sự kiện trùng bằng phòng live thật.
5. Tối ưu trên VPS, kiểm tra OBS/công cụ phát, thử ngắn rồi thử 6 giờ.

Không mở rộng cứu mạng, tấn công người khác, mua quyền ưu tiên, nhiều phòng đấu hay nội dung AI trực tiếp trong v1.0. Thay đổi luật sau chạy thử phải có số phiên bản và danh sách thay đổi.

## 19. Luật ngắn để hiện trong game

“Bình luận VÀO để tham gia, CHỜ để đăng ký lên ghế. Cả phòng cùng trả lời theo mã câu, ví dụ 23B. Đáp án hợp lệ đầu tiên được chốt. Đúng +10 điểm; ở ghế nóng còn tăng 1 cấp. Sai hoặc hết giờ phải nhường ghế. Người chờ lên theo thứ tự và xác nhận SS khi được gọi. Tặng quà không thay đổi kết quả.”

## 20. Chỉ dẫn bàn giao cho Antigravity

Đây là nguồn luật phiên bản 1.0 của dự án. Hãy triển khai đúng các trạng thái, thời điểm và điều kiện trong tài liệu. Bắt đầu bằng mô phỏng local, không cần TikTok thật để kiểm tra logic. Không tự bổ sung luật kinh tế, đặc quyền quà tặng hoặc thay thứ tự xếp hàng. Mọi điểm chưa thể đáp ứng phải nêu rõ cùng phương án xử lý. Khi báo hoàn thành, nêu bài kiểm tra đã thực sự chạy, kết quả, hạn chế còn lại và cách khởi động bản thử.
