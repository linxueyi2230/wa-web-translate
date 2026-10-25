import { useState, useEffect } from "react";
import QRCode from "qrcode";
export function QRCodeImage({ content }: { content: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(content, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [content]);
  return src ? (
    <img className="hm-qr" src={src} alt="使用好麦 APP 扫描绑定二维码" />
  ) : null;
}
