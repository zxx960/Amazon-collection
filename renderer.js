/**
 * This file is loaded via the <script> tag in the index.html file and will
 * be executed in the renderer process for that window. No Node.js APIs are
 * available in this process because `nodeIntegration` is turned off and
 * `contextIsolation` is turned on. Use the contextBridge API in `preload.js`
 * to expose Node.js functionality from the main process.
 */

// 验证 electronAPI 是否正确注入
console.log('electronAPI available:', !!window.electronAPI)

// 等待 DOM 完全加载
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 已加载完成')
    
    const scrapeBtn = document.getElementById('scrapeBtn')
    const exportBtn = document.getElementById('exportBtn')
    const amazonUrl = document.getElementById('amazonUrl')
    const bannedWords = document.getElementById('bannedWords')
    const status = document.getElementById('status')
    const result = document.getElementById('result')

    if (!scrapeBtn || !amazonUrl || !bannedWords || !status || !result || !exportBtn) {
        console.error('无法找到必要的 DOM 元素')
        return
    }

    let scrapedData = null // 存储采集的数据

    scrapeBtn.addEventListener('click', async () => {
        const baseUrl = 'https://www.amazon.com/dp/';  // 定义公共基础链接
        // 修改原链接处理逻辑，自动补全基础链接
        const urls = amazonUrl.value.split(' ')
            .map(url => url.trim())
            .filter(url => url)
            .map(url => {
                // 如果输入不包含基础链接前缀，则自动补全
                if (!url.startsWith(baseUrl)) {
                    return baseUrl + url;
                }
                return url;  // 保留已完整的链接
            });
        if (urls.length === 0) {
            status.textContent = '请输入亚马逊商品链接'
            return
        }

        // 重置状态和结果显示
        result.innerHTML = ''
        status.textContent = '正在采集数据...'
        scrapeBtn.disabled = true

        const allResults = []
        let successCount = 0
        let failCount = 0

        try {
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i]
                status.textContent = `正在采集第 ${i + 1}/${urls.length} 个商品...`
                
                // 显示当前正在采集的链接
                result.innerHTML = `
                    <div class="current-task">
                        <p>当前采集：${url}</p>
                        <p class="progress">进度：${i + 1}/${urls.length}</p>
                    </div>
                `

                try {
                    console.log('调用 scrapeAmazon，URL:', url)
                    const response = await window.electronAPI.scrapeAmazon(url, bannedWords.value)
                    console.log('采集结果:', response)

                    if (response) {
                        // 创建JSON输出对象
                        const outputData = {
                            // '标题': response.title,
                            '链接': url,
                            '图片': response.imageLinks,
                            '视频': response.videoUrl ? "有" : "无",
                            '评分': response.rating ? response.rating.toString() : "无",
                            '评论数': response.reviewCount ? response.reviewCount.toString() : "无",
                            '亚马逊选择': response.isAmazonsChoice ? "有" : "无",
                            '原价': response.originalPrice ? response.originalPrice.toString() : "无",
                            '折扣': response.discountPercent ? response.discountPercent.toString() : "无",
                            '最终价格': response.finalPrice ? response.finalPrice.toString() : "无",
                            '优惠券': response.hasCoupon ? "有" : "无",
                            '优惠券百分比': response.couponPercent ? response.couponPercent.toString() : "无",
                            '亚马逊确认适配': response.hasConfirmedFit ? "有" : "无",
                            '来自品牌': response.hasFromBrand ? "有" : "无",
                            'A+视频': response.hasAPlusVideo ? "有" : "无",
                            // '违禁词': response.hasBannedWords || "无",
                            '违禁词': response.detectedBannedWords ? response.detectedBannedWords.join(',') : "无",
                            '更多选项': response.hasMoreOptions ? "有" : "无",
                            '时间': (() => {
                                const now = new Date()
                                const year = now.getFullYear()
                                const month = String(now.getMonth() + 1).padStart(2, '0')
                                const day = String(now.getDate()).padStart(2, '0')
                                const hour = String(now.getHours()).padStart(2, '0')
                                const minute = String(now.getMinutes()).padStart(2, '0')
                                const second = String(now.getSeconds()).padStart(2, '0')
                                return `${year}-${month}-${day} ${hour}:${minute}:${second}`
                            })(),
                        }
                        allResults.push(outputData)
                        successCount++
                    } else {
                        allResults.push({
                            error: '采集失败',
                            source_url: url,
                            timestamp: new Date().toISOString()
                        })
                        failCount++
                    }
                } catch (error) {
                    console.error('采集过程中发生错误:', error)
                    allResults.push({
                        error: error.message || '未知错误',
                        source_url: url,
                        timestamp: new Date().toISOString()
                    })
                    failCount++
                }
            }

            // 存储采集的数据并启用导出按钮
            scrapedData = allResults
            exportBtn.disabled = false

            // 格式化JSON输出
            const formattedJson = JSON.stringify(allResults, null, 2)

            // 创建预格式化的代码块来显示JSON
            result.innerHTML = `
                <div class="summary">
                    <p>采集完成！成功: ${successCount} 个, 失败: ${failCount} 个</p>
                </div>
                <pre style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto;">
                    <code>${formattedJson}</code>
                </pre>
            `

            status.textContent = `采集完成！成功: ${successCount} 个, 失败: ${failCount} 个`
        } catch (error) {
            console.error('采集过程中发生错误:', error)
            status.textContent = `发生错误：${error.message || '未知错误'}`
            exportBtn.disabled = true
        } finally {
            scrapeBtn.disabled = false
            // 所有任务完成后关闭浏览器
            try {
                await window.electronAPI.closeBrowser()
            } catch (error) {
                console.error('关闭浏览器时发生错误:', error)
            }
        }
    })

    // 添加导出按钮的点击事件处理
    exportBtn.addEventListener('click', async () => {
        if (!scrapedData || scrapedData.length === 0) {
            status.textContent = '没有可导出的数据'
            return
        }

        try {
            exportBtn.disabled = true
            status.textContent = '正在导出Excel...'

            // 处理数据，将数组转换为字符串
            const processedData = scrapedData.map(item => ({
                ...item,
                '图片': Array.isArray(item['图片']) ? item['图片'].join('，') : item['图片'],
                '违禁词': Array.isArray(item['违禁词']) ? item['违禁词'].join('、') : item['违禁词']
            }))

            const response = await window.electronAPI.exportToExcel(processedData)
            
            if (response.success) {
                status.textContent = '导出成功！'
            } else {
                status.textContent = `导出失败：${response.error || '未知错误'}`
            }
        } catch (error) {
            console.error('导出过程中发生错误:', error)
            status.textContent = `导出失败：${error.message || '未知错误'}`
        } finally {
            exportBtn.disabled = false
        }
    })
})
