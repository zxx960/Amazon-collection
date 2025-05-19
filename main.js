// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const XLSX = require('xlsx')
const fs = require('fs')

puppeteer.use(StealthPlugin())

let mainWindow
let browserInstance = null  // 添加全局浏览器实例变量

// 读取配置文件
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (error) {
    console.error('读取配置文件失败:', error);
    app.quit();
  }
}
function getChromiumPath() {
  // 开发环境路径
  if (process.env.NODE_ENV === 'development') {
    return path.join(
      __dirname,
      'node_modules',
      'puppeteer',
      '.local-chromium',
      'win64-121.0.6167.85',  // 替换为你的 Chromium 版本号
      'chrome-win64',
      'chrome.exe'
    );
  }

  // 生产环境路径
  return path.join(
    process.resourcesPath,  // Electron 资源目录（如 Resources/）
    'puppeteer-chromium',   // 对应 extraResources 中的 "to" 名称
    'win64-121.0.6167.85',
    'chrome-win64',
    'chrome.exe'
  );
}
// 检查到期时间
function checkTrial() {
  try {
    const { expireDate } = loadConfig().trial;
    if (new Date() > new Date(expireDate)) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: '软件已到期',
        message: '软件已到期，请联系管理员获取授权。'
      });
      app.quit();
      return false;
    }
    return true;
  } catch {
    app.quit();
    return false;
  }
}

function createWindow () {
  if (!checkTrial()) return;

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('index.html')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// 初始化浏览器实例
async function initBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      executablePath: getChromiumPath(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-accelerated-2d-canvas',
        '--disable-canvas-aa',
        '--disable-2d-canvas-clip-aa',
        '--disable-gl-drawing-for-tests'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    })
  }
  return browserInstance
}

// 关闭浏览器实例
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close()
    browserInstance = null
  }
}

// 修改爬虫处理函数
ipcMain.handle('scrape-amazon', async (event, url, bannedWords) => {
  console.log('收到采集请求:', url)
  console.log('违禁词:', bannedWords)
  try {
    const browser = await initBrowser()
    const page = await browser.newPage()
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    })

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    })

    await page.goto(url, {
      waitUntil: ['networkidle0', 'domcontentloaded', 'load'],
      timeout: 60000
    })

    const [titleElement, altImagesElement] = await Promise.all([
      page.waitForSelector('#productTitle', { timeout: 20000 }),
      page.waitForSelector('#altImages', { timeout: 20000 })
    ]).catch(error => {
      console.error('等待元素超时:', error)
      throw new Error('页面加载超时，请重试')
    })

    await page.waitForTimeout(Math.random() * 1000 + 500)

    const result = await page.evaluate((bannedWords) => {
      const title = document.querySelector('#productTitle')?.textContent?.trim() || ''
      
      const imageLinks = Array.from(document.querySelectorAll('#altImages .imageThumbnail img'))
        .map(img => img.src?.replace(/_US40_/, '_US1500_'))
        .filter(Boolean)

      const videoUrl = document.querySelector('#altImages .videoThumbnail img')?.src || null

      // 提取价格信息
      const priceDiv = document.querySelector('#corePriceDisplay_desktop_feature_div')
      let originalPrice = null
      let discountPercent = null
      let finalPrice = null

      if (priceDiv) {
        // 提取原始价格（List Price）
        const listPriceElement = priceDiv.querySelector('.a-text-price[data-a-strike="true"] .a-offscreen')
        if (listPriceElement) {
          const priceText = listPriceElement.textContent.trim()
          originalPrice = parseFloat(priceText.replace(/[^0-9.]/g, ''))
        }

        // 提取折扣百分比
        const discountElement = priceDiv.querySelector('.savingPriceOverride')
        if (discountElement) {
          const discountText = discountElement.textContent.trim()
          discountPercent = parseFloat(discountText.replace(/[^0-9.]/g, ''))
        }

        // 提取最终价格
        const priceElement = priceDiv.querySelector('.priceToPay')
        if (priceElement) {
          const wholePart = priceElement.querySelector('.a-price-whole')?.textContent?.replace(/[^0-9]/g, '') || ''
          const fractionPart = priceElement.querySelector('.a-price-fraction')?.textContent?.trim() || ''
          if (wholePart) {
            finalPrice = parseFloat(`${wholePart}.${fractionPart}`)
          }
        }

        // 如果没有优惠信息，原始价格就是最终价格
        if (!discountPercent && finalPrice) {
          originalPrice = finalPrice
          discountPercent = 0
        }
      }

      // 检查优惠券信息
      const promoPriceBlock = document.querySelector('#promoPriceBlockMessage_feature_div')
      let hasCoupon = false
      let couponPercent = null
      
      if (promoPriceBlock) {
        const couponText = promoPriceBlock.querySelector('.couponLabelText')?.textContent?.trim() || ''
        if (couponText) {
          hasCoupon = true
          // 提取优惠券百分比
          const couponMatch = couponText.match(/(\d+)%/)
          if (couponMatch) {
            couponPercent = parseInt(couponMatch[1])
          }
        }
      }

      // 检查是否有 Amazon Confirmed Fit 标识
      const hasConfirmedFit = document.querySelector('#automotive-pf-primary-view-confirmed-fit-icon') !== null

      // 检查是否有 From the brand 部分
      const hasFromBrand = Array.from(document.querySelectorAll('h2')).some(h2 => h2.textContent.trim() === 'From the brand')

      // 检查是否有 A+ Video
      const hasAPlusVideo = document.querySelector('[id^="aplus-"][id$="-container-element_html5_api"]') !== null

      // 检查违禁词
      const pageText = document.body.innerText.toLowerCase()
      const bannedWordsArray = bannedWords ? bannedWords.split(',').map(word => word.trim().toLowerCase()) : []
      const foundBannedWords = bannedWordsArray.filter(word => pageText.includes(word))
      const hasBannedWords = foundBannedWords.length > 0
      const detectedBannedWords = hasBannedWords ? foundBannedWords : []

      // 检查是否有 More Options to Consider 部分
      const hasMoreOptions = Array.from(document.querySelectorAll('h3')).some(h3 => 
        h3.classList.contains('a-text-center') && 
        h3.classList.contains('aplus-h1') && 
        h3.classList.contains('a-text-bold') && 
        h3.textContent.trim() === 'More Options to Consider'
      )

      // 检查是否为 Amazon's Choice
      const acBadgeDiv = document.querySelector('#acBadge_feature_div')
      const isAmazonsChoice = acBadgeDiv ? acBadgeDiv.querySelector('.ac-badge-wrapper') !== null : false
      console.log('Is Amazon\'s Choice:', isAmazonsChoice)

      // 获取评分
      const ratingElement = document.querySelector('#acrPopover .a-size-base.a-color-base')
      console.log('Rating element found:', !!ratingElement)
      if (ratingElement) {
        console.log('Rating text:', ratingElement.textContent)
      }
      const rating = ratingElement ? parseFloat(ratingElement.textContent.trim()) : null
      
      // 获取评论数量
      const reviewCountElement = document.querySelector('#acrCustomerReviewText')
      console.log('Review count element found:', !!reviewCountElement)
      console.log('Review count element HTML:', reviewCountElement?.outerHTML)
      let reviewCount = null
      if (reviewCountElement) {
        const reviewText = reviewCountElement.textContent.trim()
        console.log('Raw review text:', reviewText)
        // 提取数字
        const match = reviewText.match(/(\d+)/)
        console.log('Regex match result:', match)
        reviewCount = match ? parseInt(match[1]) : null
        console.log('Final parsed review count:', reviewCount)
      }

      // 尝试其他可能的选择器
      const altReviewElement = document.querySelector('[data-asin] #acrCustomerReviewText')
      if (altReviewElement) {
        console.log('Alternative review element found:', altReviewElement.textContent)
      }

      // 输出整个评论区域的HTML以供调试
      const reviewSection = document.querySelector('#averageCustomerReviews')
      console.log('Full review section HTML:', reviewSection?.outerHTML)

      return { 
        title, 
        imageLinks, 
        videoUrl, 
        rating, 
        reviewCount, 
        isAmazonsChoice,
        originalPrice,
        discountPercent,
        finalPrice,
        hasCoupon,
        couponPercent,
        hasConfirmedFit,
        hasFromBrand,
        hasAPlusVideo,
        hasBannedWords,
        detectedBannedWords,
        hasMoreOptions
      }
    }, bannedWords)

    await page.close()  // 只关闭页面，不关闭浏览器
    return result
  } catch (error) {
    console.error('爬取过程中发生错误:', error)
    throw error
  }
})

// 添加关闭浏览器的处理函数
ipcMain.handle('close-browser', async () => {
  await closeBrowser()
  return { success: true }
})

// 添加导出Excel的处理函数
ipcMain.handle('export-to-excel', async (event, data) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      title: '保存Excel文件',
      defaultPath: path.join(app.getPath('downloads'), 'amazon-data.xlsx'),
      filters: [
        { name: 'Excel Files', extensions: ['xlsx'] }
      ]
    })

    if (!filePath) {
      return { success: false, error: '未选择保存位置' }
    }

    // 准备Excel数据
    const workbook = XLSX.utils.book_new()
    
    // 直接使用数组数据创建工作表
    const worksheet = XLSX.utils.json_to_sheet(data)
    
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Amazon数据')
    
    // 使用 XLSX.write 而不是 writeFile
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    require('fs').writeFileSync(filePath, excelBuffer)

    return { success: true, message: '导出成功' }
  } catch (error) {
    console.error('Export error:', error)
    return { success: false, error: error.message || '导出失败' }
  }
})

// 在应用退出时确保关闭浏览器
app.on('window-all-closed', async function () {
  await closeBrowser()
  if (process.platform !== 'darwin') app.quit()
})
