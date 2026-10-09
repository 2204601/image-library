//! PDF thumbnails on Windows: the first page drawn by Windows.Data.Pdf
//! (built into Windows 10 and later), as PNG.

use std::path::Path;
use windows::core::HSTRING;
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Storage::StorageFile;
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// The first page of the PDF at `path`, its longer side `max` px.
pub fn render_pdf_page(path: &Path, max: u32) -> windows::core::Result<Vec<u8>> {
    // Rayon worker threads start without COM; an already-initialised thread
    // just returns S_FALSE / RPC_E_CHANGED_MODE, both fine here.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
    let doc = PdfDocument::LoadFromFileAsync(&file)?.join()?;
    let page = doc.GetPage(0)?;
    let size = page.Size()?;
    let options = PdfPageRenderOptions::new()?;
    // PNG is the default encoder; give the longer side.
    if size.Width >= size.Height {
        options.SetDestinationWidth(max)?;
    } else {
        options.SetDestinationHeight(max)?;
    }
    let stream = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&stream, &options)?.join()?;
    let len = stream.Size()? as u32;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(len)?.join()?;
    let mut data = vec![0u8; len as usize];
    reader.ReadBytes(&mut data)?;
    Ok(data)
}
