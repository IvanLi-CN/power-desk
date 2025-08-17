use embassy_executor::Spawner;
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Instant, Timer};

/// 看门狗监控的任务类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WatchedTask {
    Protector,
    ChargeChannel,
}

/// 任务状态信息
#[derive(Debug, Clone)]
struct TaskStatus {
    last_feed_time: Instant,
    is_active: bool,
    timeout_count: u32,
}

impl TaskStatus {
    fn new() -> Self {
        Self {
            last_feed_time: Instant::now(),
            is_active: true,
            timeout_count: 0,
        }
    }

    fn feed(&mut self) {
        self.last_feed_time = Instant::now();
        self.is_active = true;
    }

    fn is_timeout(&self, timeout_duration: Duration) -> bool {
        self.is_active && self.last_feed_time.elapsed() > timeout_duration
    }

    fn record_timeout(&mut self) {
        self.timeout_count += 1;
    }
}

/// 看门狗状态管理器
struct WatchdogState {
    protector_status: TaskStatus,
    charge_channel_status: TaskStatus,
    timeout_duration: Duration,
    base_timeout_duration: Duration,
    consecutive_restarts: u32,
    last_restart_time: Option<Instant>,
}

impl WatchdogState {
    fn new(timeout_duration: Duration) -> Self {
        Self {
            protector_status: TaskStatus::new(),
            charge_channel_status: TaskStatus::new(),
            timeout_duration,
            base_timeout_duration: timeout_duration,
            consecutive_restarts: 0,
            last_restart_time: None,
        }
    }

    fn feed_task(&mut self, task: WatchedTask) {
        match task {
            WatchedTask::Protector => self.protector_status.feed(),
            WatchedTask::ChargeChannel => self.charge_channel_status.feed(),
        }
        log::debug!("Watchdog: Task {:?} fed", task);
    }

    fn check_timeouts(&mut self) -> Option<WatchedTask> {
        // 检查是否应该应用退避策略
        if self.should_apply_backoff() {
            return None; // 暂时不触发重启
        }

        if self.protector_status.is_timeout(self.timeout_duration) {
            log::error!("Watchdog: Protector task timeout detected!");
            self.protector_status.record_timeout();
            return Some(WatchedTask::Protector);
        }

        if self.charge_channel_status.is_timeout(self.timeout_duration) {
            log::error!("Watchdog: ChargeChannel task timeout detected!");
            self.charge_channel_status.record_timeout();
            return Some(WatchedTask::ChargeChannel);
        }

        None
    }

    fn should_apply_backoff(&self) -> bool {
        const MAX_CONSECUTIVE_RESTARTS: u32 = 5;
        const BACKOFF_WINDOW_MS: u64 = 30000; // 30秒

        if self.consecutive_restarts >= MAX_CONSECUTIVE_RESTARTS {
            if let Some(last_restart) = self.last_restart_time {
                if last_restart.elapsed().as_millis() < BACKOFF_WINDOW_MS {
                    log::warn!(
                        "Watchdog: Too many consecutive restarts ({}), applying backoff",
                        self.consecutive_restarts
                    );
                    return true;
                }
            }
        }
        false
    }

    fn record_restart(&mut self) {
        self.consecutive_restarts += 1;
        self.last_restart_time = Some(Instant::now());

        // 动态调整超时时间
        if self.consecutive_restarts > 2 {
            let multiplier = (self.consecutive_restarts - 1).min(5); // 最多5倍
            self.timeout_duration = Duration::from_millis(
                self.base_timeout_duration.as_millis() as u64 * multiplier as u64,
            );
            log::warn!(
                "Watchdog: Increased timeout to {}ms due to {} consecutive restarts",
                self.timeout_duration.as_millis(),
                self.consecutive_restarts
            );
        }
    }

    fn reset_restart_counter(&mut self) {
        if self.consecutive_restarts > 0 {
            log::info!("Watchdog: Resetting restart counter, system stable");
            self.consecutive_restarts = 0;
            self.timeout_duration = self.base_timeout_duration;
        }
    }

    fn get_status_info(&self) -> String<256> {
        let mut info = String::new();
        let _ = write!(
            info,
            "Protector: {}ms ago, ChargeChannel: {}ms ago",
            self.protector_status.last_feed_time.elapsed().as_millis(),
            self.charge_channel_status
                .last_feed_time
                .elapsed()
                .as_millis()
        );
        info
    }
}

// 全局看门狗状态
static WATCHDOG_STATE: Mutex<CriticalSectionRawMutex, Option<WatchdogState>> = Mutex::new(None);

/// 初始化看门狗系统
pub async fn init_watchdog(timeout_ms: u64) {
    let timeout_duration = Duration::from_millis(timeout_ms);
    let state = WatchdogState::new(timeout_duration);

    WATCHDOG_STATE.lock().await.replace(state);

    log::info!("Watchdog initialized with timeout: {}ms", timeout_ms);
}

/// 喂狗函数 - 由被监控的任务调用
pub async fn feed_watchdog(task: WatchedTask) {
    if let Some(ref mut state) = *WATCHDOG_STATE.lock().await {
        state.feed_task(task);
    }
}

/// 检查是否有任务超时
async fn check_watchdog_timeouts() -> Option<WatchedTask> {
    if let Some(ref mut state) = *WATCHDOG_STATE.lock().await {
        state.check_timeouts()
    } else {
        None
    }
}

/// 获取看门狗状态信息
async fn get_watchdog_status() -> Option<String<256>> {
    if let Some(ref state) = *WATCHDOG_STATE.lock().await {
        Some(state.get_status_info())
    } else {
        None
    }
}

/// 记录重启事件
async fn record_restart() {
    if let Some(ref mut state) = *WATCHDOG_STATE.lock().await {
        state.record_restart();
    }
}

/// 重置重启计数器
async fn reset_restart_counter() {
    if let Some(ref mut state) = *WATCHDOG_STATE.lock().await {
        state.reset_restart_counter();
    }
}

/// 系统重启函数
fn system_restart() -> ! {
    log::error!("Watchdog triggered system restart!");

    // 等待日志输出完成
    for _ in 0..10000 {
        // 简单的延时循环
        unsafe { core::arch::asm!("nop") };
    }

    // 触发panic，让esp-backtrace处理重启
    panic!("Watchdog timeout - system restart");
}

/// 看门狗监控任务
#[embassy_executor::task]
pub async fn watchdog_task() {
    log::info!("Watchdog task started");

    let check_interval = Duration::from_millis(500); // 每500ms检查一次
    let mut status_report_counter = 0u32;

    loop {
        Timer::after(check_interval).await;

        // 检查是否有任务超时
        if let Some(timeout_task) = check_watchdog_timeouts().await {
            log::error!("Watchdog timeout detected for task: {:?}", timeout_task);

            // 记录重启
            record_restart().await;

            // 打印最后的状态信息
            if let Some(status) = get_watchdog_status().await {
                log::error!("Final watchdog status: {}", status.as_str());
            }

            // 触发系统重启
            system_restart();
        }

        // 每10秒打印一次状态信息（用于调试）
        status_report_counter += 1;
        if status_report_counter >= 20 {
            // 20 * 500ms = 10s
            status_report_counter = 0;
            if let Some(status) = get_watchdog_status().await {
                log::info!("Watchdog status: {}", status.as_str());
            }

            // 如果系统运行稳定超过60秒，重置重启计数器
            if status_report_counter % 120 == 0 {
                // 120 * 500ms = 60s
                reset_restart_counter().await;
            }
        }
    }
}

/// 启动看门狗系统
pub async fn start_watchdog(
    spawner: &Spawner,
    timeout_ms: u64,
) -> Result<(), embassy_executor::SpawnError> {
    init_watchdog(timeout_ms).await;
    spawner.spawn(watchdog_task())
}

// 导入必要的格式化支持
use core::fmt::Write;
use heapless::String;

/// 测试看门狗功能 - 故意让任务卡死
#[embassy_executor::task]
pub async fn test_watchdog_timeout() {
    log::warn!("Starting watchdog timeout test in 10 seconds...");
    Timer::after(Duration::from_millis(10000)).await;

    log::error!("Simulating task hang - watchdog should trigger restart in 2 seconds");

    // 故意进入无限循环，不喂狗
    loop {
        Timer::after(Duration::from_millis(100)).await;
        // 不调用 feed_watchdog，模拟任务卡死
    }
}

/// 启动看门狗测试模式
#[allow(dead_code)]
pub async fn start_watchdog_test(
    spawner: &Spawner,
    timeout_ms: u64,
) -> Result<(), embassy_executor::SpawnError> {
    init_watchdog(timeout_ms).await;
    spawner.spawn(watchdog_task())?;
    spawner.spawn(test_watchdog_timeout())
}
